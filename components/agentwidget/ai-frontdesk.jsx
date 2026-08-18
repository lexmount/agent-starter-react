'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RoomEvent } from 'livekit-client';
import { AnimatePresence, motion } from 'motion/react';
import { createLexVoiceAdapter } from '@lexmount/agentwidget-sdk/adapter-lexvoice';
import { createAgentWidgetResourceRegistry } from '@lexmount/agentwidget-sdk/core';
import {
  AgentWidgetAmbient,
  AgentWidgetDock,
  CompactSurface,
  DOCK_APPS,
  RECIPE_BY_ID,
  createCanvasState,
  createDefaultCatalogModels,
  deriveCanvasScene,
  recipeForWidgetType,
  removeCanvasSurface,
  upsertCanvasSurface,
} from '@lexmount/agentwidget-sdk/react';
import {
  createAgentWidgetSurfaceChannelClient,
  hasConfiguredAgentWidgetSurfaceChannel,
} from '@lexmount/agentwidget-sdk/surface-client';
import { useChat, useRoomContext, useVoiceAssistant } from '@livekit/components-react';
import { useSession } from '@/components/app/session-provider';
import { TileLayout } from '@/components/app/tile-layout';
import { useChatMessages } from '@/hooks/useChatMessages';
import {
  getActiveAgentSession,
  registerAgentSessionLocalCleanup,
  requestAgentSessionStop,
} from '@/lib/session-stop-client';

function connectionLabel(connection) {
  return (
    {
      idle: '点击呼吸球开始',
      connecting: '正在连接',
      reconnecting: '正在重连',
      connected: '已连接',
    }[connection] ?? 'AI 前台'
  );
}

export function AiFrontdesk({ onStartCall, startDisabled = false, startPending = false }) {
  const room = useRoomContext();
  const voiceAssistant = useVoiceAssistant();
  const { send } = useChat();
  const { appConfig, isSessionActive, endSession, getCurrentSessionId, browserSourceClient } =
    useSession();
  const messages = useChatMessages({
    enableSmartParticipantMatching: appConfig.enableSmartParticipantMatching,
    enableTranscriptionDebug: appConfig.enableTranscriptionDebug,
    userTranscriptionIdentities: appConfig.userTranscriptionIdentities,
  });
  const [models, setModels] = useState(createDefaultCatalogModels);
  const [canvas, setCanvas] = useState(() => createCanvasState([]));
  const [lastRecipeByDock, setLastRecipeByDock] = useState({});
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const resources = useMemo(() => createAgentWidgetResourceRegistry(), []);
  const runtimeRef = useRef({});

  const connection = isSessionActive
    ? room.state === 'disconnected'
      ? 'connecting'
      : room.state
    : 'idle';
  const agentState = isSessionActive ? (voiceAssistant.state ?? 'idle') : 'idle';
  const launchPhase = isSessionActive || canvas.surfaceIds.length > 0 ? 'active' : 'intro';
  runtimeRef.current = {
    agentState,
    cameraEnabled,
    connection,
    microphoneEnabled,
    onStartCall,
    room,
    send,
  };

  const setMicrophone = useCallback(
    async (enabled) => {
      if (browserSourceClient.enabled && appConfig.usesBrowserRawAudioInput) {
        await browserSourceClient.setAudioEnabled(enabled);
      } else {
        await room.localParticipant.setMicrophoneEnabled(enabled);
      }
      setMicrophoneEnabled(enabled);
    },
    [appConfig.usesBrowserRawAudioInput, browserSourceClient, room]
  );

  const setCamera = useCallback(
    async (enabled) => {
      if (browserSourceClient.enabled && appConfig.usesBrowserRawVideoInput) {
        await browserSourceClient.setVideoEnabled(enabled);
      } else {
        await room.localParticipant.setCameraEnabled(enabled);
      }
      setCameraEnabled(enabled);
    },
    [appConfig.usesBrowserRawVideoInput, browserSourceClient, room]
  );

  runtimeRef.current.setCamera = setCamera;
  runtimeRef.current.setMicrophone = setMicrophone;

  const adapterClient = useMemo(() => {
    const listeners = new Set();
    const snapshot = () => ({
      agentState: runtimeRef.current.agentState,
      cameraEnabled: runtimeRef.current.cameraEnabled,
      connection: runtimeRef.current.connection,
      microphoneEnabled: runtimeRef.current.microphoneEnabled,
      roomName: room.name || null,
    });
    const emit = (type) => {
      const next = snapshot();
      for (const listener of listeners) listener({ type }, next);
    };
    const onConnection = () => emit('connection');
    room.on(RoomEvent.ConnectionStateChanged, onConnection);
    return {
      room,
      resourceRegistry: resources,
      getSnapshot: snapshot,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      startAudio: () => room.startAudio(),
      start: () => Promise.resolve(runtimeRef.current.onStartCall?.()),
      sendText: (text) => runtimeRef.current.send(text),
      stop: () => endSession(),
      setMicrophoneEnabled: (enabled) => runtimeRef.current.setMicrophone(enabled),
      setCameraEnabled: (enabled) => runtimeRef.current.setCamera(enabled),
      dispose: async () => {
        room.off(RoomEvent.ConnectionStateChanged, onConnection);
        listeners.clear();
        resources.clear();
      },
    };
  }, [endSession, resources, room]);

  const adapter = useMemo(() => createLexVoiceAdapter({ client: adapterClient }), [adapterClient]);
  useEffect(() => () => void adapterClient.dispose(), [adapterClient]);

  useEffect(() => {
    if (!hasConfiguredAgentWidgetSurfaceChannel()) return undefined;
    const client = createAgentWidgetSurfaceChannelClient();
    const unsubscribe = client.subscribe((event) => {
      if (event.type !== 'surface') return;
      const widget = event.envelope?.surface;
      const recipe = recipeForWidgetType(widget?.widgetType);
      const payload = widget?.payload ?? widget?.data;
      if (!recipe || !payload || typeof payload !== 'object') return;
      setModels((current) => ({
        ...current,
        [recipe.id]: {
          widgetType: recipe.id,
          title: widget.title || current[recipe.id].title,
          payload,
        },
      }));
      setLastRecipeByDock((current) => ({ ...current, [recipe.dockId]: recipe.id }));
      setCanvas((current) => upsertCanvasSurface(current, recipe.id));
    });
    return () => {
      unsubscribe();
      client.dispose();
    };
  }, []);

  const stopSession = useCallback(() => {
    const sessionId = getCurrentSessionId() ?? getActiveAgentSession()?.sessionId;
    const localCleanup = Promise.resolve().then(() => adapter.stop());
    registerAgentSessionLocalCleanup(localCleanup);
    void requestAgentSessionStop(sessionId);
  }, [adapter, getCurrentSessionId]);

  const selectDock = useCallback(
    (dockId) => {
      const recipeId = lastRecipeByDock[dockId];
      if (!recipeId) return;
      setCanvas((current) => upsertCanvasSurface(current, recipeId));
    },
    [lastRecipeByDock]
  );

  const openDockIds = useMemo(
    () => [
      ...new Set(
        canvas.surfaceIds.map((recipeId) => RECIPE_BY_ID.get(recipeId)?.dockId).filter(Boolean)
      ),
    ],
    [canvas.surfaceIds]
  );
  const focusedRecipe = RECIPE_BY_ID.get(canvas.focusedSurfaceId);
  const focusedDockId = focusedRecipe?.dockId ?? null;
  const latestAgentMessage = [...messages]
    .reverse()
    .find((message) => message.from?.isLocal === false || !message.from);
  const agentCaption = latestAgentMessage
    ? {
        id: latestAgentMessage.id,
        source: 'agent',
        text: latestAgentMessage.message,
      }
    : null;

  return (
    <main className="ai-frontdesk" data-launch-phase={launchPhase} data-agent-state={agentState}>
      <AgentWidgetAmbient agentState={agentState} />
      <div className="ai-frontdesk-curtain" aria-hidden="true" />
      <header className="ai-frontdesk-header">
        <span className="ai-frontdesk-brand">{appConfig.companyName || 'Lexmount'}</span>
        <span className="ai-frontdesk-status" data-connection={connection}>
          {connectionLabel(connection)}
        </span>
      </header>

      {isSessionActive && (
        <div className="ai-frontdesk-video" aria-hidden={canvas.surfaceIds.length > 0}>
          <TileLayout
            chatOpen={false}
            videoTrackConfigs={appConfig.availableVideoTracks}
            defaultVideoTrackId={appConfig.defaultVideoTrack}
            showDefaultCameraPreview={appConfig.showDefaultCameraPreview}
            debugVideo={appConfig.debugVideo}
          />
        </div>
      )}

      {!isSessionActive && canvas.surfaceIds.length === 0 && (
        <p className="ai-frontdesk-intro">
          {startPending ? '正在唤醒 AI 前台' : '看见、听见，并把任务变成可操作的界面'}
        </p>
      )}

      <section className="ai-frontdesk-stage" aria-live="polite">
        <motion.div
          className="ai-frontdesk-canvas"
          data-canvas-scene={deriveCanvasScene(canvas.surfaceIds)}
          layout
        >
          <AnimatePresence initial={false}>
            {canvas.surfaceIds.map((recipeId) => {
              const recipe = RECIPE_BY_ID.get(recipeId);
              if (!recipe) return null;
              const SurfaceView = recipe.View;
              const focused = canvas.focusedSurfaceId === recipeId;
              const compact = !focused && canvas.surfaceIds.length >= 2;
              return (
                <motion.div
                  key={recipeId}
                  className="ai-frontdesk-surface"
                  data-focused={focused ? 'true' : 'false'}
                  layout
                  initial={{ opacity: 0, y: 24, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 14, scale: 0.97 }}
                >
                  {compact ? (
                    <CompactSurface
                      recipe={recipe}
                      model={models[recipeId]}
                      onFocus={() => setCanvas((current) => upsertCanvasSurface(current, recipeId))}
                    />
                  ) : (
                    <SurfaceView
                      model={models[recipeId]}
                      onMinimize={() =>
                        setCanvas((current) => removeCanvasSurface(current, recipeId))
                      }
                      onDismiss={() =>
                        setCanvas((current) => removeCanvasSurface(current, recipeId))
                      }
                    />
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      </section>

      <AgentWidgetDock
        items={DOCK_APPS}
        activeId={focusedDockId}
        openIds={openDockIds}
        onSelect={selectDock}
        onAgentSubmit={(prompt) => adapter.sendText(prompt)}
        onAgentActivate={() => {
          if (!startDisabled) void adapter.start();
        }}
        onAgentAudioUnlock={() => adapter.startAudio()}
        agentCaption={agentCaption}
        agentState={agentState}
        launchPhase={launchPhase}
        runtimeLabel={connectionLabel(connection)}
        runtimeConnection={connection}
        sessionControls={{
          cameraEnabled,
          connection,
          microphoneEnabled,
          onCameraChange: (enabled) => void adapter.setCameraEnabled(enabled),
          onMicrophoneChange: (enabled) => void adapter.setMicrophoneEnabled(enabled),
          onStop: stopSession,
        }}
      />
    </main>
  );
}

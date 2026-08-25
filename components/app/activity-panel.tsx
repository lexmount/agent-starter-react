'use client';

import { useState } from 'react';
import { ChartLineUp, X } from '@phosphor-icons/react';

interface ActivityPanelProps {
  publicUrl?: string;
}

export function ActivityPanel({ publicUrl }: ActivityPanelProps) {
  const [open, setOpen] = useState(false);

  if (!publicUrl) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="查看团队今日动态"
        className="bg-background/90 text-foreground border-input hover:bg-accent fixed top-16 right-4 z-40 flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium shadow-sm backdrop-blur transition-colors"
      >
        <ChartLineUp aria-hidden="true" className="size-4" weight="bold" />
        <span className="hidden sm:inline">团队动态</span>
      </button>

      {open && (
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="activity-panel-title"
          className="bg-background fixed inset-0 z-50 flex flex-col"
        >
          <header className="border-input flex h-14 shrink-0 items-center justify-between border-b px-4 sm:px-6">
            <div className="flex items-center gap-2">
              <ChartLineUp aria-hidden="true" className="text-primary size-5" weight="bold" />
              <div>
                <h2 id="activity-panel-title" className="text-sm font-semibold">
                  团队今日动态
                </h2>
                <p className="text-muted-foreground text-[10px]">公共聚合视图 · 不展示个人明细</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="关闭团队动态"
              className="hover:bg-accent grid size-9 place-items-center rounded-full transition-colors"
            >
              <X aria-hidden="true" className="size-4" weight="bold" />
            </button>
          </header>
          <iframe
            title="Lex 团队今日动态"
            src={publicUrl}
            className="min-h-0 flex-1 border-0"
            allow="clipboard-read; clipboard-write"
          />
        </section>
      )}
    </>
  );
}

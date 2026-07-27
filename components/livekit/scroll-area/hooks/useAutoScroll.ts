import { type RefObject, useEffect } from 'react';
import { createAutoScrollController } from '@/lib/auto-scroll-controller';

export function useAutoScroll<T extends HTMLElement>(scrollContentRef: RefObject<T | null>) {
  useEffect(() => {
    const scrollContentContainer = scrollContentRef.current;
    if (!scrollContentContainer) return;

    const controller = createAutoScrollController({
      getDistanceFromBottom: () =>
        scrollContentContainer.scrollHeight -
        scrollContentContainer.clientHeight -
        scrollContentContainer.scrollTop,
      scrollToBottom: () => {
        scrollContentContainer.scrollTop = scrollContentContainer.scrollHeight;
      },
    });
    const resizeObserver = new ResizeObserver(controller.handleContentResize);

    scrollContentContainer.addEventListener('scroll', controller.handleScroll, {
      passive: true,
    });

    if (scrollContentContainer.firstElementChild) {
      resizeObserver.observe(scrollContentContainer.firstElementChild);
    }

    controller.handleContentResize();

    return () => {
      resizeObserver.disconnect();
      scrollContentContainer.removeEventListener('scroll', controller.handleScroll);
    };
  }, [scrollContentRef]);
}

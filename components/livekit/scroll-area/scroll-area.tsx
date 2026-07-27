'use client';

import { useRef } from 'react';
import { useAutoScroll } from '@/components/livekit/scroll-area/hooks/useAutoScroll';
import { cn } from '@/lib/utils';

interface ScrollAreaProps {
  children?: React.ReactNode;
}

export function ScrollArea({
  className,
  children,
}: ScrollAreaProps & React.HTMLAttributes<HTMLDivElement>) {
  const scrollContentRef = useRef<HTMLDivElement>(null);

  useAutoScroll(scrollContentRef);

  return (
    <div ref={scrollContentRef} className={cn('overflow-y-scroll', className)}>
      <div>{children}</div>
    </div>
  );
}

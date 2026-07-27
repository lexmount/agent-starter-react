const AUTO_SCROLL_THRESHOLD_PX = 100;

interface AutoScrollControllerOptions {
  getDistanceFromBottom: () => number;
  scrollToBottom: () => void;
}

export interface AutoScrollController {
  handleContentResize: () => void;
  handleScroll: () => void;
}

export function createAutoScrollController({
  getDistanceFromBottom,
  scrollToBottom,
}: AutoScrollControllerOptions): AutoScrollController {
  let isFollowingNewestMessage = true;

  function handleContentResize() {
    if (isFollowingNewestMessage) {
      scrollToBottom();
    }
  }

  function handleScroll() {
    isFollowingNewestMessage = getDistanceFromBottom() < AUTO_SCROLL_THRESHOLD_PX;
  }

  return {
    handleContentResize,
    handleScroll,
  };
}

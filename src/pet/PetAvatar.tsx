import { useCallback, useRef } from "react";
import { AlphaMask } from "./alphaMask";
import { registerAlphaTarget } from "./hitTest";

interface PetAvatarProps {
  src: string;
  onPointerDown: (e: React.PointerEvent<HTMLImageElement>) => void;
}

/**
 * Placeholder avatar. Only its opaque pixels capture the mouse; P0-3 replaces
 * this with the `AvatarRenderer` interface and sprite-variant implementation.
 */
export function PetAvatar({ src, onPointerDown }: PetAvatarProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);

  const rebuildMask = useCallback(() => {
    const img = imgRef.current;
    if (img) registerAlphaTarget(img, AlphaMask.fromImage(img));
  }, []);

  return (
    <img
      ref={imgRef}
      className="pet-avatar"
      src={src}
      alt="桌宠"
      draggable={false}
      data-hit="alpha"
      onLoad={rebuildMask}
      onPointerDown={onPointerDown}
    />
  );
}

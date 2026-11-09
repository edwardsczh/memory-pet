import { useEffect, useRef } from "react";
import type { Emotion } from "../../core/model";
import type { AvatarRenderer } from "./AvatarRenderer";
import { manifestUrl } from "./manifest";
import { SpriteAvatarRenderer } from "./SpriteAvatarRenderer";

interface AvatarProps {
  characterId: string;
  emotion?: Emotion;
  talking?: boolean;
  /** Breathing, blinking and idle fidgets. */
  idle?: boolean;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
}

/**
 * Declarative wrapper around an `AvatarRenderer`. Only the character's opaque
 * pixels capture the mouse (see hitTest.ts).
 */
export function Avatar({
  characterId,
  emotion = "neutral",
  talking = false,
  idle = true,
  onPointerDown,
}: AvatarProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<AvatarRenderer | null>(null);

  useEffect(() => {
    const renderer = new SpriteAvatarRenderer();
    rendererRef.current = renderer;
    hostRef.current?.append(renderer.element);
    renderer.load(manifestUrl(characterId)).catch((err: unknown) => console.error(err));
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [characterId]);

  // `characterId` is listed so a freshly created renderer receives the current state.
  useEffect(() => rendererRef.current?.setEmotion(emotion), [characterId, emotion]);
  useEffect(() => rendererRef.current?.setTalking(talking), [characterId, talking]);
  useEffect(() => rendererRef.current?.setIdleAnimation(idle), [characterId, idle]);

  return <div ref={hostRef} className="pet-avatar" onPointerDown={onPointerDown} />;
}

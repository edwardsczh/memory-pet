// Builds the layered sprite avatars in public/avatar/<id>/ from the downloaded
// DiceBear "Toon Head" definition (CC BY 4.0, see ASSETS_LICENSES.md).
//
//   npm run avatars
//
// Every layer is a full-canvas SVG with the same viewBox, so the renderer can
// stack them without per-layer offsets. Effect overlays (blush, tears, marks)
// are original drawings made for this project.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const VIEWBOX = { x: 64, y: 0, width: 640, height: 768 };
const DISPLAY = { width: 220, height: 264 };

const CREDIT = {
  title: "ToonHead",
  author: "Johan Melin",
  url: "https://www.figma.com/community/file/1589627891082866389",
  via: "https://www.dicebear.com/styles/toon-head/",
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  attribution:
    "Character art adapted from “ToonHead” by Johan Melin (https://www.figma.com/community/file/1589627891082866389), via DiceBear, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Modified: recolored, split into layers, added eye/mouth variants and expression effects.",
};

const CHARACTERS = [
  {
    id: "momo",
    name: "桃桃",
    colors: { skin: "#f1c3a5", hair: "#724133", clothes: "#ec4899", stroke: "#000000" },
    parts: { rearHair: "longWavy", body: "body", head: "head", clothes: "dress", hair: "bun" },
  },
  {
    id: "kai",
    name: "小凯",
    colors: { skin: "#e8b796", hair: "#2c1b18", clothes: "#0b3286", stroke: "#000000" },
    parts: { body: "body", head: "head", clothes: "openJacket", hair: "undercut" },
  },
];

// slot -> variant; `blink: null` means the eyes are already closed.
const EMOTIONS = {
  neutral: { brows: "neutral", eyes: "happy", mouth: "smile", talk: "talk" },
  happy: {
    brows: "happy",
    eyes: "bow",
    mouth: "laugh",
    talk: "smile",
    blink: null,
    fx: ["blush", "sparkle"],
  },
  sad: { brows: "sad", eyes: "lookDown", mouth: "sad", talk: "talk", fx: ["tear"] },
  angry: { brows: "angry", eyes: "happy", mouth: "angry", talk: "sad", fx: ["anger"] },
  surprised: { brows: "raised", eyes: "wide", mouth: "agape", talk: "talk", fx: ["surprise"] },
  shy: {
    brows: "sad",
    eyes: "humble",
    mouth: "smile",
    talk: "talk",
    blink: null,
    fx: ["blushStrong", "sweat"],
  },
  thinking: { brows: "raised", eyes: "lookUp", mouth: "sad", talk: "talk", fx: ["question"] },
};
const DEFAULT_BLINK = "humble";

let def;
let placement;

function loadDefinition(id) {
  def = JSON.parse(
    readFileSync(join(root, "public/avatar", id, "source/toon-head.min.json"), "utf8"),
  );
  placement = Object.fromEntries(def.canvas.elements.map((e) => [e.name, e.attributes.transform]));
}

function renderElement(el, colors) {
  const attrs = Object.entries(el.attributes ?? {})
    .map(([k, v]) => ` ${k}="${typeof v === "object" ? colors[v.name] : v}"`)
    .join("");
  const children = (el.children ?? []).map((c) => renderElement(c, colors)).join("");
  return `<${el.name}${attrs}>${children}</${el.name}>`;
}

function componentElements(component, variant) {
  const v = def.components[component]?.variants[variant];
  if (!v) throw new Error(`unknown ${component} variant: ${variant}`);
  return v.elements;
}

function renderComponent(component, variant, colors) {
  const body = componentElements(component, variant)
    .map((e) => renderElement(e, colors))
    .join("");
  return `<g transform="${placement[component]}">${body}</g>`;
}

// Eye variants derived from "happy" by moving the pupils inside the eye whites.
// Element order in the definition: white, pupil, lashes (left), then the same for the right eye.
function renderGazeEyes(dx, dy, colors) {
  const [lWhite, lPupil, lLash, rWhite, rPupil, rLash] = componentElements("eyes", "happy");
  const shifted = (pupil, clip) => {
    const t = pupil.attributes.transform ? ` ${pupil.attributes.transform}` : "";
    const moved = {
      ...pupil,
      attributes: { ...pupil.attributes, transform: `translate(${dx} ${dy})${t}` },
    };
    return `<g clip-path="url(#${clip})">${renderElement(moved, colors)}</g>`;
  };
  const clip = (id, white) => `<clipPath id="${id}"><path d="${white.attributes.d}"/></clipPath>`;
  return (
    `<g transform="${placement.eyes}">` +
    `<defs>${clip("eyeL", lWhite)}${clip("eyeR", rWhite)}</defs>` +
    [lWhite, rWhite].map((e) => renderElement(e, colors)).join("") +
    shifted(lPupil, "eyeL") +
    shifted(rPupil, "eyeR") +
    [lLash, rLash].map((e) => renderElement(e, colors)).join("") +
    `</g>`
  );
}

function renderEyes(variant, colors) {
  if (variant === "lookUp") return renderGazeEyes(9, -9, colors);
  if (variant === "lookDown") return renderGazeEyes(-3, 8, colors);
  return renderComponent("eyes", variant, colors);
}

function renderMouth(variant, colors) {
  // Small open mouth for speech, derived from "agape".
  if (variant === "talk") {
    const inner = componentElements("mouth", "agape")
      .map((e) => renderElement(e, colors))
      .join("");
    return `<g transform="${placement.mouth}"><g transform="translate(57.5 26) scale(1.05 0.62) translate(-57.5 -22)">${inner}</g></g>`;
  }
  return renderComponent("mouth", variant, colors);
}

const INK = 'stroke="#2b1a1a" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"';
const drop = (x, y, s, fill) =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M0-22C6-12 14-4 14 6A14 14 0 0 1-14 6C-14-4-6-12 0-22Z" fill="${fill}" ${INK}/>` +
  `<ellipse transform="translate(${x} ${y}) scale(${s})" cx="-5" cy="4" rx="3" ry="5" fill="#fff" opacity=".8"/>`;
const star = (x, y, r, fill) =>
  `<path transform="translate(${x} ${y})" d="M0 ${-r}Q${r * 0.18} ${-r * 0.18} ${r} 0Q${r * 0.18} ${r * 0.18} 0 ${r}Q${-r * 0.18} ${r * 0.18} ${-r} 0Q${-r * 0.18} ${-r * 0.18} 0 ${-r}Z" fill="${fill}" ${INK}/>`;
const cheeks = (opacity) =>
  `<ellipse cx="303" cy="466" rx="36" ry="17" fill="#ff6f91" opacity="${opacity}"/>` +
  `<ellipse cx="465" cy="466" rx="36" ry="17" fill="#ff6f91" opacity="${opacity}"/>`;
const hatch = (cx) =>
  [-16, 0, 16]
    .map(
      (o) =>
        `<path d="M${cx + o - 7} 476L${cx + o + 7} 456" stroke="#d63f6b" stroke-width="4" stroke-linecap="round" opacity=".8"/>`,
    )
    .join("");

const FX = {
  blush: cheeks(0.42),
  blushStrong: cheeks(0.62) + hatch(303) + hatch(465),
  sparkle:
    star(150, 200, 26, "#ffd166") + star(628, 150, 20, "#ffd166") + star(612, 228, 11, "#fff2b3"),
  tear: drop(318, 470, 1, "#8fd3ff"),
  sweat: drop(598, 300, 1.35, "#8fd3ff"),
  anger:
    `<g transform="translate(596 180) rotate(12)" fill="none" stroke="#e5303a" stroke-width="11" stroke-linecap="round">` +
    `<path d="M-30-8Q-10-8-8-30"/><path d="M8-30Q10-8 30-8"/><path d="M30 8Q10 8 8 30"/><path d="M-8 30Q-10 8-30 8"/></g>`,
  surprise:
    `<g fill="none" stroke="#2b1a1a" stroke-width="7" stroke-linecap="round">` +
    `<path d="M150 230L118 205"/><path d="M140 280L100 276"/><path d="M155 182L138 150"/>` +
    `<path d="M618 230L650 205"/><path d="M628 280L668 276"/><path d="M613 182L630 150"/></g>`,
  question:
    `<g transform="translate(626 150) rotate(14)">` +
    `<path d="M-22-18C-22-44 22-46 22-20C22-2 2 0 2 18" fill="none" stroke="#2b1a1a" stroke-width="20" stroke-linecap="round"/>` +
    `<path d="M-22-18C-22-44 22-46 22-20C22-2 2 0 2 18" fill="none" stroke="#7c6cf0" stroke-width="11" stroke-linecap="round"/>` +
    `<circle cx="2" cy="44" r="10" fill="#7c6cf0" ${INK}/></g>` +
    `<circle cx="560" cy="236" r="7" fill="#7c6cf0" ${INK}/><circle cx="588" cy="208" r="10" fill="#7c6cf0" ${INK}/>`,
};

function svg(content) {
  const { x, y, width, height } = VIEWBOX;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${width}" height="${height}" fill="none" shape-rendering="auto">${content}</svg>\n`;
}

function buildCharacter(c) {
  loadDefinition(c.id);
  const dir = join(root, "public/avatar", c.id);
  const layersDir = join(dir, "layers");
  rmSync(layersDir, { recursive: true, force: true });
  mkdirSync(layersDir, { recursive: true });
  const write = (name, content) => {
    writeFileSync(join(layersDir, `${name}.svg`), svg(content));
    return `layers/${name}.svg`;
  };

  // Hair is split: the back part sits behind the head, the front part above the face.
  const back = ["rearHair", "body", "head", "clothes"]
    .filter((p) => c.parts[p])
    .map((p) => renderComponent(p, c.parts[p], c.colors))
    .join("");
  const base = write("base", back);
  const front = write("hair", renderComponent("hair", c.parts.hair, c.colors));

  const written = new Map();
  const layer = (kind, variant) => {
    const key = `${kind}-${variant}`;
    if (!written.has(key)) {
      const content =
        kind === "eyes"
          ? renderEyes(variant, c.colors)
          : kind === "mouth"
            ? renderMouth(variant, c.colors)
            : kind === "brows"
              ? renderComponent("eyebrows", variant, c.colors)
              : FX[variant];
      written.set(key, write(key, content));
    }
    return written.get(key);
  };

  const emotions = {};
  for (const [emotion, e] of Object.entries(EMOTIONS)) {
    const blink = e.blink === undefined ? DEFAULT_BLINK : e.blink;
    emotions[emotion] = {
      eyes: layer("eyes", e.eyes),
      brows: layer("brows", e.brows),
      mouth: layer("mouth", e.mouth),
      blink: blink === null ? null : layer("eyes", blink),
      talk: layer("mouth", e.talk),
      fx: (e.fx ?? []).map((f) => layer("fx", f)),
    };
  }

  const manifest = {
    version: 1,
    id: c.id,
    name: c.name,
    size: DISPLAY,
    anchor: { x: 0.5, y: 1 },
    layers: { base: [base], front: [front] },
    emotions,
    credits: [CREDIT],
  };
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${c.id}: ${written.size + 2} layers`);
}

CHARACTERS.forEach(buildCharacter);

import test from "node:test";
import assert from "node:assert/strict";
import { applyCanvasCommand } from "../../packages/edit-core/canvas-commands.ts";
import { parseGsapAnimationsFromHtml } from "../../packages/edit-core/gsap-mutations.ts";

const source =
  '<div data-composition-id="stage" data-duration="6"><div id="a" style="translate: 3px 4px">A</div><div id="b">B</div></div>';
const target = { id: "a" };
const move = {
  kind: "moveCanvasElement",
  target,
  x: 20,
  y: 30,
  time: 2,
} as const;

test("canvas drags preserve the authored baseline and reject unresolved batch targets", () => {
  const result = applyCanvasCommand(source, move);
  assert.match(result, /translate:\s*20px 30px/);
  assert.match(result, /data-hf-studio-original-inline-translate="3px 4px"/);
  assert.throws(
    () =>
      applyCanvasCommand(source, {
        kind: "editElements",
        patches: [
          {
            target,
            operations: [
              { type: "text-content", property: "", value: "changed" },
            ],
          },
          {
            target: { id: "absent" },
            operations: [
              { type: "inline-style", property: "color", value: "red" },
            ],
          },
        ],
      }),
    /not found/,
  );
});

test("same drag edits an owned tween at composition time and refuses an ambiguous shared tween", () => {
  const animation = (selector: string) =>
    source.replace(
      '</div><div id="b">',
      '</div><script>const tl=gsap.timeline();tl.fromTo("' +
        selector +
        '",{x:0,y:0},{x:40,y:40,ease:"none",duration:4},0);</script><div id="b">',
    );
  const result = applyCanvasCommand(animation("#a"), move);
  const tween = parseGsapAnimationsFromHtml(result).animations.find(
    (a) => a.keyframes,
  );
  assert.deepEqual(
    tween?.keyframes?.keyframes.find((k) => k.percentage === 50)?.properties,
    { x: 20, y: 30 },
  );
  assert.match(result, /translate:\s*3px 4px/);
  assert.throws(
    () => applyCanvasCommand(animation("#a,#b"), move),
    /multiple elements/,
  );
});

test("duplicate, group and ungroup use the same source transforms as Studio", () => {
  const copy = applyCanvasCommand(source, {
    kind: "duplicateElement",
    target,
    newId: "copy",
  });
  assert.match(copy, /id="copy"/);
  const bbox = { left: 0, top: 0, width: 80, height: 40 };
  const grouped = applyCanvasCommand(source, {
    kind: "groupElements",
    groupId: "pair",
    targets: [target, { id: "b" }],
    bbox,
    rebases: [],
  });
  assert.match(grouped, /id="pair"/);
  const flat = applyCanvasCommand(grouped, {
    kind: "ungroupElements",
    target: { id: "pair" },
  });
  assert.doesNotMatch(flat, /id="pair"/);
  assert.match(flat, /id="a"/);
  assert.match(flat, /id="b"/);
});

test("canvas rejects incomplete selections, ambiguous IDs and edits to locked layers", () => {
  const root = '<html><body><main data-composition-id="stage">';
  const locked =
    root +
    '<section data-timeline-locked><div id="a">A</div></section><div id="b">B</div><script>const tl=gsap.timeline();tl.to("#a",{x:50,duration:1},0);</script></main></body></html>';
  const tween = parseGsapAnimationsFromHtml(locked).animations[0];
  assert.throws(() => applyCanvasCommand(locked, move), /unlock/i);
  assert.throws(
    () =>
      applyCanvasCommand(locked, {
        kind: "editAnimation",
        mutations: [
          {
            type: "update-property",
            animationId: tween.id,
            property: "x",
            value: 30,
          },
        ],
      }),
    /unlock/i,
  );
  assert.throws(
    () =>
      applyCanvasCommand(locked, {
        kind: "editElements",
        patches: [
          {
            target: { id: "a" },
            operations: [
              { type: "inline-style", property: "color", value: "blue" },
            ],
          },
        ],
      }),
    /unlock/i,
  );
  assert.throws(
    () =>
      applyCanvasCommand(source, {
        kind: "groupElements",
        targets: [target, { id: "missing" }],
        groupId: "group",
        bbox: { left: 0, top: 0, width: 20, height: 20 },
        rebases: [],
      }),
    /not found/i,
  );
  assert.throws(
    () =>
      applyCanvasCommand(locked, {
        kind: "deleteCanvasElements",
        targets: [{ id: "b" }, target],
      }),
    /unlock/i,
  );
  assert.throws(
    () => applyCanvasCommand(source, { ...move, target: {} }),
    /choose a canvas element/i,
  );
  const repeats =
    root +
    '<div data-hf-id="a"><span data-hf-id="same"></span></div><div data-hf-id="b"><span data-hf-id="same"></span></div></main></body></html>';
  assert.throws(
    () => applyCanvasCommand(repeats, { ...move, target: { hfId: "same" } }),
    /ambiguous/i,
  );
  assert.doesNotMatch(
    applyCanvasCommand(source, {
      kind: "deleteCanvasElements",
      targets: [target, { id: "b" }],
    }),
    /id="[ab]"/,
  );
});

test("headless drags accept measured endpoints when the tween inherits its destination", () => {
  const html = '<html><body><div id="a">A</div><script>const tl=gsap.timeline();tl.from("#a",{x:10,y:10,duration:4},0);</script></body></html>';
  assert.throws(() => applyCanvasCommand(html, move), /measured.*ease/);
  const result = applyCanvasCommand(html, { ...move, samples:{ease:"none",end:{x:80,y:60}} });
  const frames = parseGsapAnimationsFromHtml(result).animations.find(a => a.keyframes)?.keyframes?.keyframes;
  assert.deepEqual(frames?.find(k=>k.percentage===50)?.properties,{x:20,y:30});
  assert.deepEqual(frames?.find(k=>k.percentage===100)?.properties,{x:80,y:60});
});

test("canvas deletion of a mixed selection updates timeline length and the remaining linked partner", () => {
  const source = '<html><body><main data-composition-id="stage" data-duration="10"><video data-link="av" id="v" data-start="0" data-duration="10"></video><audio id="a" data-link="av" data-start="0" data-duration="4"></audio><span id="title">Title</span></main></body></html>';
  const targets = [{selector:'video[data-link="av"]'},{id:"title"}];
  const result = applyCanvasCommand(source,{kind:"deleteCanvasElements",targets});
  assert.doesNotMatch(result, /<video|data-link=|id="title"/);
  assert.match(result, /<main[^>]+data-duration="4"/);
  assert.match(result, /<audio/);
  assert.throws(()=>applyCanvasCommand(source.replace('<audio','<audio data-timeline-locked'), {kind:"deleteCanvasElements",targets}),/unlock/i);
});

test("Studio whole-path drags and headless deltas translate every keyframe without changing playhead mode", () => {
  const html = '<html><body><div id="a">A</div><script>const tl=gsap.timeline();tl.fromTo("#a",{x:0,y:0},{x:130,y:32,duration:7,ease:"none"},0);</script></body></html>';
  const delta = {x:34.767,y:20.664};
  const before = parseGsapAnimationsFromHtml(html).animations[0]!;
  const ui = applyCanvasCommand(html,{kind:"editAnimation",mutations:[{type:"shift-animation-path",animationId:before.id,deltaX:delta.x,deltaY:delta.y}]});
  const shift = {kind:"moveCanvasElement",target,delta} as const;
  assert.equal(applyCanvasCommand(html,shift),ui);
  assert.equal(applyCanvasCommand(html,{...shift,mode:"wholePath",time:0}),ui);
  const frames = (s:string) => parseGsapAnimationsFromHtml(s).animations.find(a=>a.keyframes)?.keyframes?.keyframes.map(k=>k.properties);
  assert.deepEqual(frames(ui),[delta,{x:164.767,y:52.664}]);
  const playhead = applyCanvasCommand(html,{kind:"moveCanvasElement",mode:"playhead",target,time:0,...delta});
  assert.deepEqual(frames(playhead),[delta,{x:130,y:32}]);
  assert.throws(()=>applyCanvasCommand(html,{...shift,x:30} as never),/either/);
  assert.match(applyCanvasCommand(source,{kind:"moveCanvasElement",target,delta:{x:10,y:-3}}), /translate:\s*13px 1px/);
});

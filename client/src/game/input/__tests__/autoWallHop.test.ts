import { describe, expect, test } from "bun:test";
import { autoWallHopKeys, makeAutoHopState } from "../autoWallHop";
import { InputBit } from "../../../net/protocol";

describe("autoWallHopKeys", () => {
  test("pushing into a touched wall pulses Jump on a cadence", () => {
    const st = makeAutoHopState();
    const keys = InputBit.Right;
    // t=0: pulse starts
    expect(autoWallHopKeys(keys, 1, 1000, st) & InputBit.Jump).toBeTruthy();
    // mid-pulse
    expect(autoWallHopKeys(keys, 1, 1050, st) & InputBit.Jump).toBeTruthy();
    // after the pulse window, before next cycle
    expect(autoWallHopKeys(keys, 1, 1150, st) & InputBit.Jump).toBeFalsy();
    // next cycle pulses again
    expect(autoWallHopKeys(keys, 1, 1265, st) & InputBit.Jump).toBeTruthy();
  });

  test("no wall contact → untouched keys, state resets", () => {
    const st = makeAutoHopState();
    autoWallHopKeys(InputBit.Right, 1, 1000, st);
    expect(st.epochMs).not.toBeNull();
    const out = autoWallHopKeys(InputBit.Right, 0, 1100, st);
    expect(out).toBe(InputBit.Right);
    expect(st.epochMs).toBeNull();
  });

  test("moving AWAY from the wall never hops", () => {
    const st = makeAutoHopState();
    const out = autoWallHopKeys(InputBit.Left, 1, 1000, st);
    expect(out & InputBit.Jump).toBeFalsy();
  });

  test("no movement input never hops", () => {
    const st = makeAutoHopState();
    const out = autoWallHopKeys(0, 1, 1000, st);
    expect(out).toBe(0);
  });

  test("existing bits are preserved", () => {
    const st = makeAutoHopState();
    const keys = InputBit.Right | InputBit.Fire;
    const out = autoWallHopKeys(keys, 1, 1000, st);
    expect(out & InputBit.Fire).toBeTruthy();
    expect(out & InputBit.Right).toBeTruthy();
  });
});

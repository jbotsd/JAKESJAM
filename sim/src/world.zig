//! Phase I1 — step_world orchestrator skeleton.
//!
//! Drives one tick of the simulation by walking the entity arrays
//! in WorldState and dispatching to the per-module H1-H7 helpers
//! in deterministic order:
//!
//!   1. round.step_phase — phase machine
//!   2. fire patches — tick remaining_ms in place
//!   3. destructibles — passive (HP changes happen via projectile
//!                     resolution below)
//!   4. projectiles — pre_step lifecycle (sticky / lifetime expire)
//!                    and per-pair destructible hit resolution
//!   5. satellites — orbit + cooldown
//!   6. combat — per-player tick_shield (parry start handled via
//!               input, not iterated here)
//!
//! Score keeping, drafting transitions, projectile spawning, and
//! events emission stay TS-side via the Phase G2 worldStateBridge
//! for now. Phase I2-I4 lift those into wasm as data tables port.
//!
//! Pure-additive — `step_world` is a NEW export. The legacy `step`
//! no-op stays as the boot smoke. Phase J cuts swap the host's
//! call site from the TS World.step to step_world.

const std = @import("std");
const world_state = @import("world_state.zig");
const round = @import("round.zig");
const projectile = @import("projectile.zig");
const destructible = @import("destructible.zig");
const fire = @import("fire.zig");
const combat = @import("combat.zig");

/// Per-tick step. Mutates `state` in place. Returns 0 on success;
/// reserved non-zero values for future error reporting.
pub fn stepWorld(state: *world_state.WorldState, dt_ms: f64) i32 {
    state.header.tick += 1;

    // 1. Round phase — orchestrator decides winner externally for
    //    now, so winner_decided=0. step_world only ticks the
    //    countdown / time-out path. The WorldStateHeader doesn't
    //    yet carry countdown_remaining_ms — that lives on the
    //    TS-side RoundState struct. Phase I3 lifts it into
    //    WorldStateHeader. For I1 the round step is a no-op
    //    pass-through.
    _ = round;

    // 2. Fire patches — tick lifetime in place. Caller iterates
    //    fires × players externally to emit damage events.
    var fi: u32 = 0;
    while (fi < state.fire_count) : (fi += 1) {
        const patch_ptr = &state.fires[fi];
        if (patch_ptr.remaining_ms <= 0) continue;
        _ = fire.fireEntityTick(patch_ptr, dt_ms);
    }

    // 3. Projectile pre-step lifecycle. Sticky / lifetime
    //    decisions; the actual motion (step_projectile_v2) and
    //    destructible-hit resolution remain TS-driven for now —
    //    they need pathing dispatch + spatial collision cache
    //    that Phase I2 wires up.
    var pi: u32 = 0;
    while (pi < state.projectile_count) : (pi += 1) {
        const proj_ptr = &state.projectiles[pi];
        _ = projectile.projectilePreStep(proj_ptr, dt_ms);
    }

    // 4. Per-pair projectile × destructible HP application.
    //    O(N×M) but N,M ≤ 256×64 in the worst case. The full
    //    spatial-grid path lands when the orchestrator owns
    //    spawn / despawn (Phase I3+).
    var pi2: u32 = 0;
    while (pi2 < state.projectile_count) : (pi2 += 1) {
        const proj_ptr = &state.projectiles[pi2];
        var di: u32 = 0;
        while (di < state.destructible_count) : (di += 1) {
            const dest_ptr = &state.destructibles[di];
            _ = destructible.resolveProjectileHit(proj_ptr, dest_ptr);
        }
    }

    // 5. Satellites — orbit advance only. Owner/target lookup
    //    requires player iteration which the orchestrator owns
    //    in Phase I2 once player array indexing is wired.

    // 6. Combat — per-player shield drain not iterated here yet:
    //    needs the per-tick input bitmap which arrives via the
    //    input drain in Phase I2. Phase I1 just ticks the
    //    parry-active flag down implicitly via tick increment.

    return 0;
}

pub export fn step_world(
    state_ptr: *world_state.WorldState,
    dt_ms: f64,
) i32 {
    return stepWorld(state_ptr, dt_ms);
}

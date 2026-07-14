const std = @import("std");

pub fn build(b: *std.Build) void {
    const wasm_target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
    });
    const optimize = b.standardOptimizeOption(.{
        .preferred_optimize_mode = .ReleaseSmall,
    });
    // Wasm artifact ships at ReleaseSmall regardless of -Doptimize so
    // dev builds aren't 500 KB. Tests still honour -Doptimize for fast
    // debug iteration.
    const wasm_optimize: std.builtin.OptimizeMode = .ReleaseSmall;

    const wasm_module = b.createModule(.{
        .root_source_file = b.path("src/root.zig"),
        .target = wasm_target,
        .optimize = wasm_optimize,
    });

    const lib = b.addExecutable(.{
        .name = "sim",
        .root_module = wasm_module,
    });
    lib.entry = .disabled;
    lib.rdynamic = true;
    lib.import_memory = false;
    lib.export_memory = true;
    lib.stack_size = 64 * 1024;

    // Install in TWO places:
    //   1. client/public/wasm/sim.wasm — Vite copies public/ verbatim
    //      to dist/, so the runtime fetches `/wasm/sim.wasm` reliably.
    //      `?url` and `new URL(...)` are tree-shaken away by rolldown
    //      in Vite 8; public/ is the documented escape hatch.
    //   2. client/src/sim/wasm/sim.wasm — Bun tests under
    //      client/src/sim/wasm/__tests__/ resolve relative paths
    //      against this location. Keeping a copy here avoids ugly
    //      ../../../public paths in test code.
    const install_public = b.addInstallFileWithDir(
        lib.getEmittedBin(),
        .{ .custom = "../../client/public/wasm" },
        "sim.wasm",
    );
    const install_test = b.addInstallFileWithDir(
        lib.getEmittedBin(),
        .{ .custom = "../../client/src/sim/wasm" },
        "sim.wasm",
    );
    b.getInstallStep().dependOn(&install_public.step);
    b.getInstallStep().dependOn(&install_test.step);

    const test_target = b.standardTargetOptions(.{});
    const sim_root_native = b.createModule(.{
        .root_source_file = b.path("src/root.zig"),
        .target = test_target,
        .optimize = optimize,
    });
    const test_module = b.createModule(.{
        .root_source_file = b.path("test/smoke.zig"),
        .target = test_target,
        .optimize = optimize,
    });
    test_module.addImport("sim_root", sim_root_native);
    const tests = b.addTest(.{ .root_module = test_module });
    const run_tests = b.addRunArtifact(tests);
    const test_step = b.step("test", "Run sim unit tests");
    test_step.dependOn(&run_tests.step);

    // Native (non-wasm) step_world benchmark (2026-07-14). Always
    // ReleaseFast regardless of -Doptimize — a benchmark run at Debug
    // speed reports meaningless numbers, and this target's only job is
    // producing an honest peak-throughput figure.
    const sim_root_bench = b.createModule(.{
        .root_source_file = b.path("src/root.zig"),
        .target = test_target,
        .optimize = .ReleaseFast,
    });
    const bench_module = b.createModule(.{
        .root_source_file = b.path("bench/step_world_bench.zig"),
        .target = test_target,
        .optimize = .ReleaseFast,
    });
    bench_module.addImport("sim_root", sim_root_bench);
    const bench_exe = b.addExecutable(.{ .name = "step_world_bench", .root_module = bench_module });
    const run_bench = b.addRunArtifact(bench_exe);
    const bench_step = b.step("bench", "Run the native step_world benchmark (ReleaseFast, no wasm boundary)");
    bench_step.dependOn(&run_bench.step);
}

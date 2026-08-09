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

    // ── Native harness (gospel-goal N0 — the port passport) ──────────────
    // The same core, compiled native, so an archived .jjr can be stepped
    // headless and hashed against the wasm path. This is a PROMOTION of the
    // native module the test step already proved builds, not a second
    // implementation — `sim_root_native` is literally the module above.
    const native_module = b.createModule(.{
        .root_source_file = b.path("src/native/main.zig"),
        .target = test_target,
        .optimize = optimize,
    });
    native_module.addImport("sim_root", sim_root_native);
    const native_exe = b.addExecutable(.{
        .name = "jjsim",
        .root_module = native_module,
    });
    b.installArtifact(native_exe);

    const native_step = b.step("native", "Build the jjsim native harness");
    native_step.dependOn(&b.addInstallArtifact(native_exe, .{}).step);

    const run_native = b.addRunArtifact(native_exe);
    if (b.args) |args| run_native.addArgs(args);
    const run_native_step = b.step("run-native", "Run jjsim (pass args after --)");
    run_native_step.dependOn(&run_native.step);

    // Native-only unit tests (msgpack + .jjr reader). Wired into `test` so
    // the passport's parsing layer is covered by the same gate as the sim.
    const native_test_module = b.createModule(.{
        .root_source_file = b.path("src/native/jjr.zig"),
        .target = test_target,
        .optimize = optimize,
    });
    const native_tests = b.addTest(.{ .root_module = native_test_module });
    test_step.dependOn(&b.addRunArtifact(native_tests).step);

    const msgpack_test_module = b.createModule(.{
        .root_source_file = b.path("src/native/msgpack.zig"),
        .target = test_target,
        .optimize = optimize,
    });
    const msgpack_tests = b.addTest(.{ .root_module = msgpack_test_module });
    test_step.dependOn(&b.addRunArtifact(msgpack_tests).step);
}

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

    // gospel N1.1 — the raylib confirmation spike. Its own step, NEVER
    // wired into `test` or the default build: it links a vendored C
    // library and opens a window, so a machine without sim/vendor/raylib
    // built must still be able to run `zig build test`. Missing library =
    // this step fails, nothing else does.
    // Pin a glibc VERSION on the target so Zig supplies its own start
    // files instead of the system's crt1.o. Without this the link fails on
    // THIS box with "unhandled relocation type R_X86_64_PC64 ... in
    // crt1.o:.sframe": GCC 16 emits an .sframe section that Zig 0.15.2's
    // linker does not understand, and the toolchain pin is deliberate
    // (0.15.2 over 0.16, see the goal's toolchain note). A recorded L13
    // "this box bites" finding rather than a reason to move the pin.
    const spike_target = b.resolveTargetQuery(.{
        .cpu_arch = .x86_64,
        .os_tag = .linux,
        .abi = .gnu,
        .glibc_version = .{ .major = 2, .minor = 39, .patch = 0 },
    });
    const spike_module = b.createModule(.{
        .root_source_file = b.path("src/native/spike_raylib.zig"),
        .target = spike_target,
        .optimize = optimize,
    });
    const spike_exe = b.addExecutable(.{
        .name = "jjspike",
        .root_module = spike_module,
    });
    spike_exe.addIncludePath(b.path("vendor/raylib/src"));
    spike_exe.addObjectFile(b.path("vendor/raylib/build/raylib/libraylib.a"));
    spike_exe.linkLibC();
    // raylib's own link line on Linux/desktop.
    // Pinning the glibc target above puts Zig in cross-compile mode, which
    // stops it searching the host's library paths — so GL/X11 have to be
    // pointed at explicitly. Both halves of this are the same L13 finding:
    // the fix for the CRT problem created the library-path one.
    spike_exe.addLibraryPath(.{ .cwd_relative = "/usr/lib" });
    for ([_][]const u8{ "m", "pthread", "dl", "rt", "GL", "X11" }) |sys_lib| {
        spike_exe.linkSystemLibrary(sys_lib);
    }
    // gospel N2.1 — the native replay renderer. Same raylib link recipe as
    // the spike (and the same reasons for every line of it), plus the sim
    // itself, because it calls the SHARED stepper rather than owning a
    // loop. Also its own step, never in `test`: it needs the vendored
    // library and a display.
    const play_module = b.createModule(.{
        .root_source_file = b.path("src/native/play.zig"),
        .target = spike_target,
        .optimize = optimize,
    });
    play_module.addImport("sim_root", sim_root_native);
    const play_exe = b.addExecutable(.{ .name = "jjplay", .root_module = play_module });
    play_exe.addIncludePath(b.path("vendor/raylib/src"));
    play_exe.addObjectFile(b.path("vendor/raylib/build/raylib/libraylib.a"));
    play_exe.linkLibC();
    play_exe.addLibraryPath(.{ .cwd_relative = "/usr/lib" });
    for ([_][]const u8{ "m", "pthread", "dl", "rt", "GL", "X11" }) |sys_lib| {
        play_exe.linkSystemLibrary(sys_lib);
    }
    const play_step = b.step("play", "N2.1: build jjplay (native replay renderer)");
    play_step.dependOn(&b.addInstallArtifact(play_exe, .{}).step);
    const run_play = b.addRunArtifact(play_exe);
    if (b.args) |args| run_play.addArgs(args);
    const run_play_step = b.step("run-play", "N2.1: run jjplay (args after --)");
    run_play_step.dependOn(&run_play.step);

    const spike_step = b.step("spike-raylib", "N1.1: build the raylib confirmation spike");
    spike_step.dependOn(&b.addInstallArtifact(spike_exe, .{}).step);
    const run_spike = b.addRunArtifact(spike_exe);
    if (b.args) |args| run_spike.addArgs(args);
    const run_spike_step = b.step("run-spike", "N1.1: run the raylib spike (args after --)");
    run_spike_step.dependOn(&run_spike.step);

    // Native-only unit tests (msgpack + .jjr reader). Wired into `test` so
    // the passport's parsing layer is covered by the same gate as the sim.
    const native_test_module = b.createModule(.{
        .root_source_file = b.path("src/native/jjr.zig"),
        .target = test_target,
        .optimize = optimize,
    });
    // Bot mode selection is pure given its inputs + an rng callback, so
    // it tests here rather than needing a live host.
    const botmode_test_module = b.createModule(.{
        .root_source_file = b.path("src/bot_mode.zig"),
        .target = test_target,
        .optimize = optimize,
    });
    const botmode_tests = b.addTest(.{ .root_module = botmode_test_module });

    // The asset-pack reader is pure parsing — no raylib, no display — so
    // it belongs in `test` like the shell clock.
    const pack_test_module = b.createModule(.{
        .root_source_file = b.path("src/native/pack.zig"),
        .target = test_target,
        .optimize = optimize,
    });
    const pack_tests = b.addTest(.{ .root_module = pack_test_module });

    // The shell skeleton's pure half (the fixed-timestep clock) is a
    // normal test module — it links nothing, so it belongs in `test`
    // alongside the rest, unlike the spike.
    const shell_test_module = b.createModule(.{
        .root_source_file = b.path("src/native/shell.zig"),
        .target = test_target,
        .optimize = optimize,
    });
    const shell_tests = b.addTest(.{ .root_module = shell_test_module });

    // Stepper tests need the sim itself (hash primitives + step_world).
    const stepper_test_module = b.createModule(.{
        .root_source_file = b.path("src/native/stepper.zig"),
        .target = test_target,
        .optimize = optimize,
    });
    stepper_test_module.addImport("sim_root", sim_root_native);
    const stepper_tests = b.addTest(.{ .root_module = stepper_test_module });
    test_step.dependOn(&b.addRunArtifact(stepper_tests).step);
    const native_tests = b.addTest(.{ .root_module = native_test_module });
    test_step.dependOn(&b.addRunArtifact(native_tests).step);
    test_step.dependOn(&b.addRunArtifact(shell_tests).step);
    test_step.dependOn(&b.addRunArtifact(pack_tests).step);
    test_step.dependOn(&b.addRunArtifact(botmode_tests).step);

    const msgpack_test_module = b.createModule(.{
        .root_source_file = b.path("src/native/msgpack.zig"),
        .target = test_target,
        .optimize = optimize,
    });
    const msgpack_tests = b.addTest(.{ .root_module = msgpack_test_module });
    test_step.dependOn(&b.addRunArtifact(msgpack_tests).step);
}

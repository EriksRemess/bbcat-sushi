// SPDX-License-Identifier: GPL-2.0-or-later

imports.gi.versions.Gtk = '3.0';

const {Gio, GLib, Gtk} = imports.gi;
const ByteArray = imports.byteArray;
const System = imports.system;

if (ARGV.length < 2 || ARGV.length > 3) {
    printerr(
        'usage: smoke.js SOURCE_DIR INPUT|--animation|--tundra [static|animation]'
    );
    System.exit(2);
}

Gio.Resource.load(
    '/usr/share/sushi/org.gnome.NautilusPreviewer.src.gresource'
)._register();
imports.searchPath.push('resource:///org/gnome/NautilusPreviewer/js');
imports.searchPath.push(ARGV[0]);

Gtk.init(null);

const Viewer = imports.viewers.bbcat;
const loop = new GLib.MainLoop(null, false);
let input = ARGV[1];
let temporaryInput = null;
const expectedKind = ARGV[2] || (input === '--animation'
    ? 'animation'
    : 'static');
if (!['static', 'animation'].includes(expectedKind)) {
    printerr('expected kind must be static or animation');
    System.exit(2);
}
const expectAnimation = expectedKind === 'animation';

if (input === '--animation') {
    const [fd, path] = GLib.file_open_tmp('bbcat-sushi-XXXXXX.ans');
    GLib.close(fd);
    GLib.file_set_contents(
        path,
        ByteArray.fromString(
            '\x1b[2J\x1b[H\x1b[1;1HA\x1b[1;1HB\x1b[2J'
        )
    );
    input = path;
    temporaryInput = path;
}

if (input === '--tundra') {
    const [fd, path] = GLib.file_open_tmp('bbcat-sushi-XXXXXX.tnd');
    GLib.close(fd);
    GLib.file_set_contents(
        path,
        ByteArray.fromString('\x18TUNDRA24A')
    );
    input = path;
    temporaryInput = path;
}

const renderer = new Viewer.Klass(Gio.File.new_for_path(input));
let failure = null;

renderer.connect('notify::ready', () => {
    const isAnimation =
        renderer._animation && !renderer._animation.is_static_image();
    if (expectAnimation && !isAnimation)
        return;

    if (isAnimation !== expectAnimation) {
        failure = expectAnimation
            ? 'animation was rendered as a static image'
            : 'static input was rendered as an animation';
    }
    loop.quit();
});
renderer.connect('error', (source, error) => {
    failure = error.message;
    loop.quit();
});

const timeout = GLib.timeout_add_seconds(
    GLib.PRIORITY_DEFAULT,
    10,
    () => {
        failure = 'timed out waiting for the renderer';
        loop.quit();
        return GLib.SOURCE_REMOVE;
    }
);

loop.run();
GLib.source_remove(timeout);
renderer.destroy();
if (temporaryInput)
    GLib.unlink(temporaryInput);

if (failure) {
    printerr(`bbcat-sushi smoke test failed: ${failure}`);
    System.exit(1);
}

print(expectAnimation
    ? 'bbcat rendered a GIF and the Sushi viewer loaded its animation'
    : 'bbcat rendered a PNG and the Sushi viewer loaded it');

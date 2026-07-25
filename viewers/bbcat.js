// SPDX-License-Identifier: GPL-2.0-or-later
//
// A GNOME Sushi viewer for the formats rendered by bbcat.

const ByteArray = imports.byteArray;

imports.gi.versions.Gdk = '3.0';
imports.gi.versions.GdkPixbuf = '2.0';
imports.gi.versions.Gtk = '3.0';

const {Gdk, GdkPixbuf, Gio, GLib, GObject, Gtk} = imports.gi;

const Renderer = imports.ui.renderer;

function ioError(message) {
    return new GLib.Error(
        Gio.io_error_quark(),
        Gio.IOErrorEnum.FAILED,
        message
    );
}

function findBbcat() {
    const configured = GLib.getenv('BBCAT');
    if (configured && GLib.file_test(configured, GLib.FileTest.IS_EXECUTABLE))
        return configured;

    // The Flatpak installer places bbcat here. GLib.get_user_data_dir()
    // resolves to ~/.var/app/org.gnome.NautilusPreviewer/data in the sandbox.
    const bundled = GLib.build_filenamev([
        GLib.get_user_data_dir(),
        'bbcat-sushi',
        'bin',
        'bbcat',
    ]);
    if (GLib.file_test(bundled, GLib.FileTest.IS_EXECUTABLE))
        return bundled;

    return GLib.find_program_in_path('bbcat');
}

var Klass = GObject.registerClass({
    Implements: [Renderer.Renderer],
    Properties: {
        fullscreen: GObject.ParamSpec.boolean(
            'fullscreen', '', '', GObject.ParamFlags.READABLE, false),
        ready: GObject.ParamSpec.boolean(
            'ready', '', '', GObject.ParamFlags.READABLE, false),
    },
}, class BbcatRenderer extends Gtk.DrawingArea {
    get ready() {
        return !!this._ready;
    }

    get fullscreen() {
        return !!this._fullscreen;
    }

    get resizePolicy() {
        return Renderer.ResizePolicy.SCALED;
    }

    _init(file) {
        super._init();

        this._cancellable = new Gio.Cancellable();
        this._processes = new Set();
        this._hasAnimatedImage = false;
        this._animation = null;
        this._animationIter = null;
        this._animationTimeout = 0;
        this._pixbuf = null;
        this._scaledSurface = null;

        this.connect('destroy', this._onDestroy.bind(this));
        this._render(file);
    }

    vfunc_get_preferred_width() {
        return [1, this._pixbuf ? this._pixbuf.get_width() : 1];
    }

    vfunc_get_preferred_height() {
        return [1, this._pixbuf ? this._pixbuf.get_height() : 1];
    }

    vfunc_size_allocate(allocation) {
        super.vfunc_size_allocate(allocation);
        this._ensureScaledSurface();
    }

    vfunc_draw(context) {
        if (!this._scaledSurface)
            return false;

        const scaleFactor = this.get_scale_factor();
        const width = this.get_allocated_width();
        const height = this.get_allocated_height();
        const offsetX =
            (width - this._scaledSurface.getWidth() / scaleFactor) / 2;
        const offsetY =
            (height - this._scaledSurface.getHeight() / scaleFactor) / 2;

        context.setSourceSurface(this._scaledSurface, offsetX, offsetY);
        context.paint();
        return false;
    }

    _render(file) {
        const bbcat = findBbcat();
        if (!bbcat) {
            this.emit('error', ioError(
                'bbcat was not found. Install bbcat, then reinstall bbcat-sushi.'
            ));
            return;
        }

        // bbcat needs the original filename for extension-hinted formats such
        // as ADF, DDW, and RIPscrip. Sushi normally supplies a local GFile,
        // including document-portal paths passed to its Flatpak.
        const path = file.get_path();
        if (!path) {
            this.emit('error', ioError(
                'bbcat-sushi can only preview files available through a local path.'
            ));
            return;
        }

        // Start both jobs together. PNG renders quickly and lets Sushi open
        // immediately; if bbcat finds animation frames, the GIF replaces it
        // when ready.
        this._runBbcat(bbcat, path, false);
        this._runBbcat(bbcat, path, true);
    }

    _runBbcat(bbcat, path, tryAnimation) {
        const outputOption = tryAnimation ? '--gif' : '--output';

        let process;
        try {
            process = Gio.Subprocess.new(
                [bbcat, outputOption, '-', '--', path],
                Gio.SubprocessFlags.STDOUT_PIPE |
                Gio.SubprocessFlags.STDERR_PIPE
            );
            this._processes.add(process);
        } catch (error) {
            this.emit('error', error);
            return;
        }

        process.communicate_async(
            null,
            this._cancellable,
            (process, result) => {
                try {
                    const [, stdout, stderr] =
                        process.communicate_finish(result);

                    if (!process.get_successful()) {
                        const detail =
                            ByteArray.toString(stderr.get_data()).trim();

                        // bbcat is the format authority. A successful --gif
                        // means it found animation frames; this one exact error
                        // means the document is valid but static.
                        if (tryAnimation && detail.includes(
                            '--gif requires an animated ANSI or DDW input'
                        ))
                            return;

                        // The PNG remains a useful preview if an animation can
                        // be decoded but not encoded.
                        if (tryAnimation) {
                            logError(
                                ioError(detail || 'bbcat could not render animation.'),
                                'bbcat-sushi animation probe failed'
                            );
                            return;
                        }

                        throw ioError(detail || 'bbcat could not render this file.');
                    }

                    const stream = Gio.MemoryInputStream.new_from_bytes(stdout);
                    this._loadImage(stream, tryAnimation);
                } catch (error) {
                    if (!error.matches(
                        Gio.IOErrorEnum,
                        Gio.IOErrorEnum.CANCELLED
                    ))
                        this.emit('error', error);
                } finally {
                    this._processes.delete(process);
                }
            }
        );
    }

    _loadImage(stream, animated) {
        GdkPixbuf.PixbufAnimation.new_from_stream_async(
            stream,
            this._cancellable,
            (source, result) => {
                try {
                    const animation =
                        GdkPixbuf.PixbufAnimation.new_from_stream_finish(result);

                    // A fast PNG callback may finish after the GIF callback.
                    // Never replace the animated image with that late preview.
                    if (!animated && this._hasAnimatedImage)
                        return;

                    if (animated) {
                        this._hasAnimatedImage = true;
                        if (this._animationTimeout) {
                            GLib.source_remove(this._animationTimeout);
                            this._animationTimeout = 0;
                        }
                    }

                    const wasReady = this.ready;
                    this._animation = animation;
                    this._animationIter = animation.get_iter(null);
                    this._updateFrame();
                    if (animated && wasReady)
                        this.notify('ready');
                } catch (error) {
                    if (!error.matches(
                        Gio.IOErrorEnum,
                        Gio.IOErrorEnum.CANCELLED
                    ))
                        this.emit('error', error);
                } finally {
                    stream.close_async(
                        GLib.PRIORITY_DEFAULT,
                        null,
                        null
                    );
                }
            }
        );
    }

    _updateFrame() {
        this._pixbuf =
            this._animationIter.get_pixbuf().apply_embedded_orientation();
        this._scaledSurface = null;
        this.queue_resize();
        if (!this.ready)
            this.isReady();

        const delay = this._animationIter.get_delay_time();
        if (delay < 0)
            return;

        this._animationTimeout = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            Math.max(delay, 10),
            () => {
                this._animationTimeout = 0;
                if (this._animationIter.advance(null))
                    this._updateFrame();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _ensureScaledSurface() {
        if (!this._pixbuf || !this.get_window())
            return;

        const scaleFactor = this.get_scale_factor();
        const availableWidth = this.get_allocated_width() * scaleFactor;
        const availableHeight = this.get_allocated_height() * scaleFactor;
        if (availableWidth < 1 || availableHeight < 1)
            return;

        const originalWidth = this._pixbuf.get_width();
        const originalHeight = this._pixbuf.get_height();
        let scale = Math.min(
            availableWidth / originalWidth,
            availableHeight / originalHeight
        );

        // Keep native pixels in the normal preview window. Fullscreen may
        // enlarge the image, using nearest-neighbour scaling for crisp glyphs.
        if (!this.fullscreen)
            scale = Math.min(scale, scaleFactor);

        const width = Math.max(1, Math.floor(originalWidth * scale));
        const height = Math.max(1, Math.floor(originalHeight * scale));
        if (this._scaledSurface &&
            this._scaledSurface.getWidth() === width &&
            this._scaledSurface.getHeight() === height)
            return;

        const interpolation = scale > scaleFactor
            ? GdkPixbuf.InterpType.NEAREST
            : GdkPixbuf.InterpType.BILINEAR;
        const scaled = this._pixbuf.scale_simple(
            width,
            height,
            interpolation
        );
        this._scaledSurface = Gdk.cairo_surface_create_from_pixbuf(
            scaled,
            scaleFactor,
            this.get_window()
        );
    }

    _onDestroy() {
        this._cancellable.cancel();
        if (this._animationTimeout)
            GLib.source_remove(this._animationTimeout);
        for (const process of this._processes)
            process.force_exit();
        this._processes.clear();
    }
});

var mimeTypes = [
    'application/x-ansi-art',
    'application/x-artworx',
    'application/x-darkdraw',
    'application/x-ripscrip',
    'application/x-xbin',
    'text/x-nfo',
];

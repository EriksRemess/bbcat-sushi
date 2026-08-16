.PHONY: check check-animation-file install install-system install-flatpak install-all \
	uninstall uninstall-system uninstall-flatpak

check:
	gjs -c "const GLib = imports.gi.GLib; const source = GLib.file_get_contents('viewers/bbcat.js')[1]; new Function(new TextDecoder().decode(source));"
	gjs -c "const Gio = imports.gi.Gio; Gio.Resource.load('/usr/share/sushi/org.gnome.NautilusPreviewer.src.gresource')._register(); imports.searchPath.push('resource:///org/gnome/NautilusPreviewer/js'); imports.searchPath.push('$(CURDIR)'); const viewer = imports.viewers.bbcat; if (viewer.mimeTypes.length !== 7 || !viewer.mimeTypes.includes('application/x-tundradraw')) throw new Error('unexpected MIME registration'); print('Sushi viewer module loaded');"
	xvfb-run -a gjs tests/smoke.js "$(CURDIR)" "$(CURDIR)/README.md"
	xvfb-run -a gjs tests/smoke.js "$(CURDIR)" --animation
	xvfb-run -a gjs tests/smoke.js "$(CURDIR)" --tundra
	xmllint --noout data/bbcat-sushi.xml
	sh -n scripts/install scripts/uninstall

check-animation-file:
	@test -n "$(ANIMATION_TEST_FILE)" || { \
		echo "usage: make check-animation-file ANIMATION_TEST_FILE=/path/to/art.ans" >&2; \
		exit 2; \
	}
	xvfb-run -a gjs tests/smoke.js "$(CURDIR)" "$(ANIMATION_TEST_FILE)" animation

install:
	./scripts/install auto

install-system:
	./scripts/install system

install-flatpak:
	./scripts/install flatpak

install-all:
	./scripts/install all

uninstall:
	./scripts/uninstall all

uninstall-system:
	./scripts/uninstall system

uninstall-flatpak:
	./scripts/uninstall flatpak

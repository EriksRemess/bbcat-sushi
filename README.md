# bbcat for GNOME Sushi

`bbcat-sushi` adds ANSI and BBS artwork previews to GNOME Sushi, the preview
window opened with <kbd>Space</kbd> in Files.

The viewer runs [`bbcat`](https://bbcat.dev/) for the selected file, reads its
image output, and displays the result in Sushi. It handles ANSI/ASC/DIZ and NFO
text art, DarkDraw DDW, ArtWorx ADF, RIPscrip, and XBin files. Animated artwork
is detected by bbcat and played from its generated GIF at bbcat's frame timing.

## Requirements

- `bbcat` available as a host executable
- GNOME Sushi 46 or newer, installed either as a system package or the
  `org.gnome.NautilusPreviewer` Flatpak

On Ubuntu, the system packages can be installed with:

```console
sudo apt install bbcat gnome-sushi
```

## Install

Run:

```console
make install
```

The installer detects every installed Sushi variant:

- System Sushi receives the viewer in
  `~/.local/share/sushi/viewers/`.
- Flatpak Sushi receives the viewer in its private app data. Because its
  sandbox cannot execute the host `/usr/bin/bbcat`, the installer also copies
  the current `bbcat` executable into that private directory.

The MIME definitions are installed for the current user in both cases. No
`sudo` or Flatpak permission override is needed.

To select one variant explicitly:

```console
make install-system
make install-flatpak
```

After installing, close any open preview and select a supported artwork file in
Files. Press <kbd>Space</kbd> to preview it. If Sushi was already running, log
out and back in or terminate its existing process before trying again.

Remove both variants with:

```console
make uninstall
```

`make uninstall-system` and `make uninstall-flatpak` remove only the selected
viewer.

## How it works

Sushi looks for extra GJS viewers under `$XDG_DATA_HOME/sushi/viewers`.
`viewers/bbcat.js` registers bbcat's MIME types and implements Sushi's renderer
interface. It first asks bbcat for animated output:

```console
bbcat --gif - -- artwork.ans
```

At the same time, the viewer requests a static PNG with `bbcat --output -`.
That inexpensive preview opens the Sushi window immediately. If GIF generation
succeeds, playback replaces the PNG when it is ready; otherwise the PNG remains
as the static preview. No shell is involved, so filenames are passed unchanged.
bbcat keeps format detection, rendering, and frame timing in one place; the
plugin only displays and scales the returned image.

## Check

`make check` covers static PNG fallback and a small generated ANSI animation.
An existing animation can exercise the same viewer path with:

```console
make check-animation-file ANIMATION_TEST_FILE=/path/to/animation.ans
```

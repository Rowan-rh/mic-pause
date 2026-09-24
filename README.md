# Mic Pause

**Automatically pause browser videos while any app is using a microphone, then resume only the videos Mic Pause paused.**

Mic Pause combines a Chrome extension with a small macOS native host. It detects microphone activity from desktop apps and web pages, and pauses visible videos in browser tabs while the microphone is in use.

[简体中文](README.zh-CN.md) · [Contributing](CONTRIBUTING.md)

## Features

- Detects microphone activity across macOS input devices, including microphones selected directly by desktop apps.
- Also detects active audio streams requested by web pages through `getUserMedia`.
- Pauses visible videos in HTTP and HTTPS tabs, including muted videos.
- Resumes only videos it paused; videos already paused by the user stay paused.
- Waits for every detected microphone source to stop before resuming videos.
- Supports YouTube, Bilibili, Vimeo, Netflix, and a generic HTML video fallback.
- Lets you exclude a domain and its subdomains from automatic pausing.

## Requirements

- macOS
- Google Chrome 102 or later
- Xcode Command Line Tools, which provide the Swift compiler used to build the native host

The extension uses Manifest V3. The provided installation script registers the native host for Google Chrome. Other Chromium browsers may require registering the host in that browser's Native Messaging directory.

## Install from source

1. Download or clone the repository source.
2. In Chrome, open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**. Select the repository's `extension` directory.
3. Copy the extension ID shown on the extension card.
4. In Terminal, build and register the native host with that ID:

   ~~~sh
   cd native-host
   ./install.sh YOUR_EXTENSION_ID
   ~~~

   The script builds `mic-monitor` and writes the Native Messaging manifest to Chrome's user-level configuration directory. It does not require administrator access.
5. Return to `chrome://extensions` and reload Mic Pause. Refresh any pages that were already open. If Chrome cannot find the native host, fully quit and reopen Chrome.

The native host manifest allows only the extension ID passed to `install.sh`. If that ID changes, run the script again with the new ID.

## Use

Mic Pause is enabled by default. Open its toolbar popup to:

- Temporarily disable automatic pausing.
- See whether a microphone source is active.
- Add or remove excluded domains. For example, excluding `example.com` also excludes its subdomains.

Changes take effect while the extension is running. Refresh an already-open page if its content script was loaded before installation or an extension update.

## Permissions and privacy

Mic Pause asks for these Chrome permissions:

- **Native messaging** connects the extension to the local macOS monitor.
- **Tabs** lets the extension find supported browser tabs and send pause or resume commands.
- **Storage** saves the enabled setting and excluded domains in Chrome's local extension storage.
- **Access to all sites** is used to detect page microphone streams and control videos on HTTP and HTTPS pages. Browser-internal pages and other restricted pages remain unavailable.

The native host checks whether macOS audio input devices are in use and reports microphone state to the extension. The page bridge observes whether a page has an active audio stream from `getUserMedia`. Neither component reads, records, or uploads microphone audio. The current source does not send telemetry or make network requests. Settings remain in local Chrome storage.

## Limitations

- macOS and Google Chrome 102 or later are required by the supplied setup.
- Browser-internal pages such as `chrome://` pages, the Chrome Web Store, and some sandboxed frames cannot be controlled because Chrome restricts extension access there.
- Playback behavior varies by site. The generic fallback targets visible HTML video elements; site-specific player changes may require adapter updates.
- The native host reports microphone activity, not which app is using the microphone.

## Troubleshooting

- **The popup reports that the native host is unavailable:** confirm that `install.sh` completed, that it received the current extension ID, then restart Chrome.
- **Chrome says access to the native host is forbidden:** rerun `./install.sh YOUR_EXTENSION_ID` with the ID shown on the Mic Pause card in `chrome://extensions`.
- **An open video does not respond:** refresh the tab. Pages opened before installation or an update do not have the latest content script.
- **A page cannot be controlled:** check whether it is a browser-internal or otherwise restricted page.

For service worker logs, open `chrome://extensions`, find Mic Pause, and select **service worker** under **Inspect views**.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for local checks and contribution guidance. The GitHub Actions workflow checks JavaScript syntax, the extension manifest, shell scripts, and the Swift native host build.

## License

MIT. See [LICENSE](LICENSE).

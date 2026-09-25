# parahuman.net

Portfolio site for the Horowitz Andreessen Academy Founding Class Fellowship
application (and reusable for everything else).

Static HTML and CSS. No build step, no dependencies, no framework.

## Before submitting

A yellow banner at the top of the page counts the sections that still have no
text. **Every `<div class="slot">` block is a placeholder you replace with your
own writing.** When the last one is gone the banner disappears by itself — that
is the signal the page is ready.

The application says: *"Feel free to use AI to help code your portfolio, but we
strongly discourage using AI to write the text."* The code and the factual spec
tables here are generated; the prose is deliberately not. Keep it that way.

The facts in the tables are pulled from your own documents. **Check each one
before it goes public** — two are flagged inline as needing confirmation:

- Token Barter deployment status
- how much asteroid-miner detail you want on a public page

## Run it locally

```sh
cd ~/parahuman
python3 -m http.server 8000
# open http://localhost:8000
```

## Where it is

- Live: https://parahuman.net (Netlify; the domain's DNS is on Netlify too)
- Source: https://github.com/dylanleitenberg-tech/parahuman
- Mirror on GitHub Pages: https://dylanleitenberg-tech.github.io/parahuman/
  (its canonical tag points search engines at parahuman.net)
- Google Search Console: Domain property `parahuman.net`, verified by a TXT
  record in Netlify DNS. Keep that record.

*Hosting history: until 2026-09-23 the domain served a different site; this
one replaced it on Netlify that day.*

## What is missing and worth adding

- **Video of the rig running.** The single highest-value thing you could add.
  Nothing on this page proves the hardware works the way thirty seconds of
  footage would. It is separate from the required one-minute introduction video
  — that one is you talking to camera, not a demo.
- **A screenshot of the JARVIS HUD**, and of Neuropian if anything is
  recoverable.
- Any photo of the rig actually on your face.

## Files

```
index.html    the page
style.css     all styling; light paper by default, dark via prefers-color-scheme
assets/       renders, photos and screenshots from the project repos
robots.txt    allows all crawlers, points at the sitemap
sitemap.xml   the one URL, for Google Search Console
```

Type: Instrument Serif (display), Inter (text), JetBrains Mono (data), loaded
from Google Fonts. Figure numbers are CSS counters — add a `<figure>` anywhere
and the numbering follows.

Header portrait is `assets/dylan-school.jpg`; `assets/dylan-frc.jpg` (FRC awards
floor) is the alternate — swap the `src` in the hero.

To check a layout change without opening a browser window:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --disable-gpu --hide-scrollbars --window-size=1280,6000 \
  --screenshot=/tmp/page.png "file://$PWD/index.html"
```

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

- Source: https://github.com/dylanleitenberg-tech/parahuman (public, single-commit history)
- Live on GitHub Pages: https://dylanleitenberg-tech.github.io/parahuman/

## Moving it to parahuman.net

parahuman.net currently serves the "Who's the Next Elon" site on Netlify, and
the domain's DNS is managed by Netlify. Two ways to put this site there:

**A. Host it on Netlify (simplest, keeps everything in one place).**
In the Netlify dashboard: Add new site -> Import from Git -> this repo
(build command none, publish directory `/`). Then open the new site's
Domain settings, add `parahuman.net`, and remove it from the old site.
The old site keeps its `*.netlify.app` address.

**B. Keep it on GitHub Pages and point the domain here.**
In Netlify DNS for parahuman.net: add four `A` records for `@` ->
185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153 and a
`CNAME` for `www` -> `dylanleitenberg-tech.github.io`, and delete the old
records. Then in this repo: Settings -> Pages -> Custom domain
`parahuman.net` (that writes the CNAME file), and tick Enforce HTTPS once
the certificate is issued.

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
CNAME         custom domain for GitHub Pages
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

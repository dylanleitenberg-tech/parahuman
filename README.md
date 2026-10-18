# parahuman.net

Source of **[parahuman.net](https://parahuman.net)**, the portfolio of Dylan Leitenberg (Kauai, Hawaii): seven projects, March to October 2026. Each entry on the site gives the specs, what was hard, and what is and isn't built yet. The site and the project software were written with AI coding agents under Dylan's direction.

## Projects

**01 · AR Glasses Rig** · built and worn · [results](https://github.com/dylanleitenberg-tech/AR_Glasses_Rig)\
See-through glasses fitted with four cameras; the rig draws graphics onto real things, such as an English translation over a printed German page. Overlay accuracy is about 4–5 px, measured on the worn hardware within one wearing.\
*From → to:* stereo depth 1.48× too far (the stereo cameras had shifted in their mount) → within 1–6% of the distance solved from the printed page at 41–49 cm, live on a later worn run.

**02 · Self-Replicating Asteroid Miner** · design program (Mark 5 rev E), not built · worm CAD: [astroworm](https://github.com/dylanleitenberg-tech/astroworm) (full program repository is private)\
Design and CAD for a solar-powered machine meant to land on the asteroid Ryugu, anchor with a burrowing worm, and build a copy of itself from what it mines. The next build is the smaller Water Worm W1 (below), printed and run in a tank.

**03 · Water Worm** · CAD checked by script, not yet built · [3D model](https://parahuman.net/water-worm/)\
The asteroid worm made waterproof. The full-size machine is meant to burrow through flooded mine-tailings ponds and pump the cut to the surface as slurry; W1 is its 100 mm test model, 38 parts.\
*From → to:* rev 1, electric (29 Sep 2026) → rev 3.1, hand-cranked from the surface (14 Oct), so the first tank test needs no motors or electronics. Interference checks grew from 122 runs with 22 must-fail controls to 158 runs with 41.

**04 · J.A.R.V.I.S.** · runs on macOS · [code](https://github.com/dylanleitenberg-tech/JARVIS) (MIT)\
A voice and hand-gesture assistant with CAD you turn in the air and edit by voice: "make the nozzle 20 percent longer" took a 306-part rocket engine assembly from 3,420 to 3,855 mm long, throat fixed. Keyboard and mouse control on the Mac waits on the Accessibility permission; the Windows and Linux installers have not been run yet.\
*From → to:* first commit 22 Sep 2026 → 24 Sep: hand-driven 3D viewer, CAD edits by voice and through Claude, installers for three systems (two not yet run); Claude replies 11.7 s → about 3 s.

**05 · Neuropian** · research prototype · [neuropian.com](https://neuropian.com) · [site source](https://github.com/dylanleitenberg-tech/Neuropian)\
Searches public work for strong engineers and mathematicians. Back-tested on 11,088 Codeforces players, with traits picked on 2022–24 and tested unchanged on 2024–26: among players of equal rating, it ranked future breakthroughs (reaching a 2400 rating, Codeforces "Grandmaster", within two years) at 0.65 AUC vs 0.60 for rating alone (0.5 = chance).\
*From → to:* a six-language site with accounts, a database and chat (March–September 2026, retired) → a back-tested scout (October 2026). Contributor list: first capped at 150 → 1,857 people across 31 open-source projects (18 Oct run). 30 dossiers (short reports linking to each person's work) written.

**06 · Toknx** · live at [toknx.ai](https://toknx.ai)\
Trade AI access without money: answer other people's prompts on the AI you already pay for, earn request tokens, and spend them on models you don't have. OpenAI-compatible API; reviewed by AI red-team agents.\
*From → to:* started 11 Sep 2026 → live at toknx.ai. Ran a 59-check live attack test against the server and fixed the one failure it found.

**07 · Youth Robotics Program** · running · Kauai\
*From → to:* no STEM program for elementary students → 28 elementary students building robots with high-school mentors.

## Run locally

Static HTML and CSS, no build step. From this folder run `python3 -m http.server 8000`, then open http://localhost:8000.

## Files

`index.html` (the page), `style.css`, `assets/` (renders, photos, drawings), `water-worm/` (the 3D model page), `robots.txt`, `sitemap.xml`. The site is hosted on Netlify; a GitHub Pages copy at [dylanleitenberg-tech.github.io/parahuman](https://dylanleitenberg-tech.github.io/parahuman/) points search engines to parahuman.net.

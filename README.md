# World Cup Survivor Pool

A small static web app for running a team World Cup betting pool, hostable for free on GitHub Pages.

- Each person stakes a fixed **Rs.500**, split across **1–3 teams** (min Rs.100 per pick, multiples of 10, must total exactly Rs.500).
- A pick is "alive" until its team is eliminated; players can be partially eliminated.
- When a champion is crowned, everyone who backed that team splits the pool **proportionally** to how much they staked on it.
- Data is stored in a private Google Sheet, served through a Google Apps Script web app acting as a tiny JSON API.

## Setup

1. **Backend**: follow [`apps-script/SETUP.md`](apps-script/SETUP.md) to create the Sheet + Apps Script API and get a deployment URL.
2. **Frontend config**: paste that URL into `API_URL` in [`app.js`](app.js).
3. **Host on GitHub Pages**:
   - Push this folder to a GitHub repo.
   - Repo **Settings > Pages** > Source: deploy from branch `main`, folder `/ (root)`.
   - Your site will be live at `https://<username>.github.io/<repo>/`.

## Files

| File | Purpose |
|---|---|
| `index.html` / `style.css` / `app.js` | The static site — bet form, live team/player tracker, winners panel |
| `apps-script/Code.gs` | Backend API (paste into Apps Script) |
| `apps-script/SETUP.md` | Step-by-step backend setup |

## Keeping results up to date

The site doesn't call any sports API directly (no key needed). Match results are pushed into the Sheet via the same Apps Script `eliminateTeam` / `declareChampion` actions — either manually by an admin, or automatically if you've set up a recurring process to check results and call the API.

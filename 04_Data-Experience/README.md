# Weather Similarity

## Credits

The presentation-mode **sky background** (CSS multi-stop gradient) is adapted from [**Horizon**](https://github.com/dnlzro/horizon) by [**Daniel Lazaro**](https://github.com/dnlzro) ([@dnlzro](https://github.com/dnlzro)), which renders the atmosphere using techniques credited in that project (notably Sébastien Hillaire and Andrew Helmer’s sky rendering write-ups). Client-side solar position uses math from [SunCalc](https://github.com/mourner/suncalc) (BSD 2-Clause).

## Run locally

1. Install dependencies:
   - `npm install`
2. Start the local server:
   - `npm start`
3. Open `http://localhost:3000`.

Optional: copy `.env.example` to `.env` and set `PORT` if you need a port other than 3000.

The app finds the nearest historical weather days in the archive compared to your current conditions (Open-Meteo).

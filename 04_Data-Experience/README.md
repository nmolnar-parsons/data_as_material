# Weather Similarity + NYT Lookup

## Credits

The presentation-mode **sky background** (CSS multi-stop gradient) is adapted from [**Horizon**](https://github.com/dnlzro/horizon) by [**Daniel Lazaro**](https://github.com/dnlzro) ([@dnlzro](https://github.com/dnlzro)), which renders the atmosphere using techniques credited in that project (notably Sébastien Hillaire and Andrew Helmer’s sky rendering write-ups). Client-side solar position uses math from [SunCalc](https://github.com/mourner/suncalc) (BSD 2-Clause).

## Run locally

1. Copy `.env.example` to `.env` and set `NYT_API_KEY`.
2. Install dependencies:
   - `npm install`
3. Start the local server:
   - `npm start`
4. Open `http://localhost:3000`.

The app finds the 5 nearest weather days, and queries NYT Article Search for each one.

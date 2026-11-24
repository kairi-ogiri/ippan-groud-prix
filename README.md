# IPPAn PEOPLE's GROUD PRIX (starter)

This is a React/Vite prototype with Supabase room creation/join and realtime room/player updates.


## Setup
1. Install Node.js 20+ on a computer.
2. Copy `.env.example` to `.env`.
3. Set `VITE_SUPABASE_URL` to the project's URL and `VITE_SUPABASE_PUBLISHABLE_KEY` to the publishable key.
4. Run `npm install`, then `npm run dev` to test locally.
5. Run `npm run build` to create the deployable `dist/` folder.

## Important
The current Supabase RLS policies are intentionally open for initial testing. Before public launch, implement proper identity/authorization and restrict policies. The app currently implements basic room creation, code joining, seat allocation, realtime presence changes, host selection, basic topic and buzzer UI. It is **not yet** the complete game spec: detailed round timer, A/B block management, final scoring/IPPAN animation, chat, voice/audio controls, drawing board, AI narration, and robust host permissions still need development.

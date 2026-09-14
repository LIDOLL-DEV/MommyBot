import { GameSessions } from "../games/sessions.js";
import { GachaError } from "./store.js";

export class GachaSessions extends GameSessions {
  constructor(db, identities, now = Date.now) {
    super(db, identities, { prefix: "diaper", command: "/diapers", ErrorClass: GachaError, now });
  } // Preserve existing atelier tables and live sessions while sharing the verified browser handoff.
}

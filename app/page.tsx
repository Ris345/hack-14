import { EventLookup } from "./event-lookup";
import styles from "./page.module.css";

/** No sign-in: the page is the event lookup. */
export default function Home() {
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1 className={styles.title}>hack-14</h1>
        <p className={styles.muted}>
          Paste a Luma event link to see who’s going, what they do, and who’s
          worth meeting.
        </p>
      </header>
      <EventLookup />
    </main>
  );
}

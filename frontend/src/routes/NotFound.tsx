import { Link } from 'react-router';

import styles from './Page.module.scss';
import { paths } from './paths';

export const NotFound = () => (
  <main className={styles.page}>
    <h1>Page not found</h1>
    <p className={styles.lead}>
      <Link to={paths.home}>Go back to the start</Link>
    </p>
  </main>
);

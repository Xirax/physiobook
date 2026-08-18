import { NavLink } from 'react-router';

import styles from './NavBar.module.scss';

export interface NavItem {
  path: string;
  label: string;
}

export interface NavBarProps {
  items: readonly NavItem[];
  userName: string;
  onLogout: () => void;
  loggingOut?: boolean;
}

export const NavBar = ({ items, userName, onLogout, loggingOut = false }: NavBarProps) => (
  <header className={styles.header}>
    <span className={styles.brand}>PhysioBook</span>

    <nav aria-label="Main">
      <ul className={styles.list}>
        {items.map(({ path, label }) => (
          <li key={path}>
            <NavLink className={styles.link ?? ''} to={path}>
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>

    <div className={styles.account}>
      <span className={styles.name}>{userName}</span>

      <button className={styles.logout} type="button" onClick={onLogout} disabled={loggingOut}>
        {loggingOut ? 'Logging out…' : 'Log out'}
      </button>
    </div>
  </header>
);

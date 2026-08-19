import styles from './LoadingScreen.module.scss';

export interface LoadingScreenProps {
  label: string;
}

export const LoadingScreen = ({ label }: LoadingScreenProps) => (
  <div className={styles.screen} role="status" aria-live="polite">
    <span className={styles.spinner} aria-hidden="true" />
    {label}
  </div>
);

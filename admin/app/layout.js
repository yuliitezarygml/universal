import './styles.css';

export const metadata = { title: 'Панель «Искры»' };

export default function RootLayout({ children }) {
  return <html lang="ru"><body>{children}</body></html>;
}

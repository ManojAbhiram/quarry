import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import PaletteSwitcher from './PaletteSwitcher';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="flex items-center gap-2">
    <PaletteSwitcher />
    <button
      onClick={toggleTheme}
      className="p-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 shadow-sm hover:shadow-md transition-all duration-300 group"
      title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
    >
      {theme === 'light' ? (
        <Moon className="w-5 h-5 group-hover:rotate-12 transition-transform" />
      ) : (
        <Sun className="w-5 h-5 group-hover:rotate-90 transition-transform" />
      )}
    </button>
    </div>
  );
}

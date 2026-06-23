import {
	createContext,
	useContext,
	useEffect,
	useState,
	type ReactNode,
} from "react";

type Theme = "dark" | "light" | "system";

interface ThemeContextValue {
	theme: Theme;
	resolved: "dark" | "light";
	setTheme: (t: Theme) => void;
	toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
	theme: "dark",
	resolved: "dark",
	setTheme: () => {},
	toggle: () => {},
});

function getSystemTheme(): "dark" | "light" {
	if (typeof window === "undefined") return "dark";
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

function getStored(): Theme {
	try {
		const stored = localStorage.getItem("ai-memory-theme");
		if (stored === "dark" || stored === "light" || stored === "system")
			return stored;
	} catch (e) {
		console.warn("Failed to read theme from localStorage:", e);
	}
	return "dark";
}

function applyTheme(resolved: "dark" | "light") {
	document.documentElement.classList.toggle("dark", resolved === "dark");
	document.documentElement.classList.toggle("light", resolved === "light");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
	const [theme, setThemeState] = useState<Theme>(getStored);
	const [resolved, setResolved] = useState<"dark" | "light">(() => {
		const stored = getStored();
		return stored === "system" ? getSystemTheme() : stored;
	});

	const setTheme = (t: Theme) => {
		setThemeState(t);
		try {
			localStorage.setItem("ai-memory-theme", t);
		} catch (e) {
			console.warn("Failed to persist theme:", e);
		}
		const r = t === "system" ? getSystemTheme() : t;
		setResolved(r);
		applyTheme(r);
	};

	const toggle = () => {
		setTheme(resolved === "dark" ? "light" : "dark");
	};

	// Apply on mount
	useEffect(() => {
		applyTheme(resolved);
	}, [resolved]);

	// Listen for system preference changes
	useEffect(() => {
		if (theme !== "system") return;
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		const handler = () => {
			const r = getSystemTheme();
			setResolved(r);
			applyTheme(r);
		};
		mq.addEventListener("change", handler);
		return () => mq.removeEventListener("change", handler);
	}, [theme]);

	return (
		<ThemeContext.Provider value={{ theme, resolved, setTheme, toggle }}>
			{children}
		</ThemeContext.Provider>
	);
}

export function useTheme(): ThemeContextValue {
	return useContext(ThemeContext);
}

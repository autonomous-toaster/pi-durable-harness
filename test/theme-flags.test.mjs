/**
 * The theme flags (tasks 1.1-1.4, 2.1).
 *
 * `--theme` is a path, repeatable; `--use-theme` selects, `--no-themes` switches
 * discovery off. pi resolves a CLI path against the working directory, converts a
 * `file:` URL, and leaves a package source alone, so the flag does the same.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { resolveConfig } = await import("../dist/harness/config.js");

/** A theme pi's validator accepts: one of pi's own, renamed. */
async function theme(name) {
	const source = join(root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "modes", "interactive", "theme", "dark.json");
	return { ...JSON.parse(await readFile(source, "utf8")), name };
}

async function themeDir() {
	const root = await mkdtemp(join(tmpdir(), "pi-durable-theme-"));
	await mkdir(join(root, "themes"));
	await writeFile(join(root, "themes", "one.json"), JSON.stringify(await theme("one")), "utf8");
	await writeFile(join(root, "two.json"), JSON.stringify(await theme("two")), "utf8");
	return root;
}

test("--theme reads every value and resolves each against the working directory", async () => {
	const cwd = await themeDir();
	const config = resolveConfig(["--theme", "./themes/one.json", "--theme", "./two.json"], {}, cwd, false);
	assert.deepEqual(config.themePaths, [join(cwd, "themes", "one.json"), join(cwd, "two.json")]);
	assert.deepEqual(config.warnings, []);
});

test("a theme path that names nothing is a diagnostic, not a theme", () => {
	const config = resolveConfig(["--theme", "./missing.json"], {}, "/tmp/nowhere", false);
	assert.equal(config.themePaths.length, 1);
	assert.match(config.warnings.join("\n"), /--theme \.\/missing\.json: no theme file or directory/);
});

test("a file URL becomes its path", () => {
	const config = resolveConfig(["--theme", pathToFileURL("/opt/themes/t.json").href], {}, "/tmp", false);
	assert.deepEqual(config.themePaths, ["/opt/themes/t.json"]);
});

test("--no-themes sets the switch and leaves a requested theme alone", () => {
	const config = resolveConfig(["--no-themes"], {}, "/tmp", false);
	assert.equal(config.noThemes, true);
	assert.deepEqual(config.themePaths, []);
});

test("--use-theme names the theme the session starts on", () => {
	const config = resolveConfig(["--use-theme", "solarized"], {}, "/tmp", false);
	assert.equal(config.useTheme, "solarized");
});

test("--use-theme without a value is refused by name", () => {
	const config = resolveConfig(["--use-theme"], {}, "/tmp", false);
	assert.equal(config.useTheme, undefined);
	assert.match(config.warnings.join("\n"), /missing value for --use-theme/);
});

test("--help lists all three theme flags", async () => {
	const { execFile } = await import("node:child_process");
	const help = await new Promise((done) => {
		execFile(process.execPath, [join(root, "dist", "cli.js"), "--help"], { cwd: root }, (_error, stdout) => done(stdout));
	});
	for (const flag of ["--theme <path>", "--use-theme <name>", "--no-themes"]) {
		assert.ok(help.includes(flag), `--help is missing ${flag}`);
	}
	assert.ok(!/Accepted for pi compatibility and not acted on:\s*\n\s*--export, --theme/.test(help));
});

test("the resource loader reads a theme from --theme, and keeps it under --no-themes", async () => {
	const cwd = await themeDir();
	const { DefaultResourceLoader } = await import("@earendil-works/pi-coding-agent");
	const { homedir } = await import("node:os");
	for (const noThemes of [false, true]) {
		const config = resolveConfig(["--theme", "./themes/one.json", ...(noThemes ? ["--no-themes"] : [])], {}, cwd, false);
		const loader = new DefaultResourceLoader({
			cwd: config.cwd,
			agentDir: join(homedir(), ".pi-durable", "agent"),
			additionalThemePaths: [...config.themePaths],
			noThemes: config.noThemes,
		});
		await loader.reload({ resolveProjectTrust: async () => false });
		const themes = loader.getThemes();
		assert.deepEqual(
			themes.themes.map((entry) => entry.name).filter((name) => name === "one"),
			["one"],
			`noThemes=${noThemes}`,
		);
	}
});

test("the interface starts on the selected theme, and on the stored one when no flag arrived", async () => {
	const { applyThemeSelection } = await import("../dist/harness/settings.js");
	const { interactiveModeOptions } = await import("../dist/harness/tui/run.js");
	const { SettingsManager } = await import("@earendil-works/pi-coding-agent");
	const agentDir = await mkdtemp(join(tmpdir(), "pi-durable-settings-"));

	// `--use-theme solarized`: pi's startup selects by overriding the setting.
	const selected = SettingsManager.create(agentDir, agentDir);
	applyThemeSelection(selected, "solarized");
	assert.equal(selected.getSettings().theme, "solarized");
	assert.equal(interactiveModeOptions({ initialThemeSetting: "solarized" }).initialThemeSetting, "solarized");

	// No flag: the stored selection stands, and pi is told nothing, so it reads the settings.
	const stored = SettingsManager.create(agentDir, agentDir);
	applyThemeSelection(stored, undefined);
	assert.notEqual(stored.getSettings().theme, "solarized");
	assert.equal("initialThemeSetting" in interactiveModeOptions({}), false);
});

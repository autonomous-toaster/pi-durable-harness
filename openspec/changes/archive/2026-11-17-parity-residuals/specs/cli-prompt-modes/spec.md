## Task Reference

| T ID | Description |
| --- | --- |
| T1.1 | Read `--theme` as a repeatable path and resolve each path against the working directory |
| T1.2 | Read `--no-themes` as a switch |
| T1.3 | Read `--use-theme` and select the named theme before the session opens |
| T1.4 | Hand the theme paths and the switch to both resource-loader constructions |
| T1.5 | Document the three theme flags in the help text |
| T5.1 | Document the flags and remove the cache-warming limitation |

## ADDED Requirements

### Requirement: A requested theme loads before the session opens

T1.1 SHALL read every `--theme` value BEFORE T1.4 SHALL load a theme from the resource loader.

#### Scenario: Two theme paths arrive

- **WHEN** T1.1 reads `--theme ./one.json --theme ./two`
- **THEN** T1.1 SHALL resolve both against the working directory

#### Scenario: A directory arrives

- **WHEN** T1.1 reads a path that names a directory
- **THEN** T1.4 SHALL load every theme file the directory holds

### Requirement: An unresolvable theme path is a diagnostic

T1.1 SHALL ALWAYS report a theme path that names nothing as a diagnostic rather than a theme.

#### Scenario: A path that names nothing

- **WHEN** T1.1 reads `--theme ./missing.json`
- **THEN** T1.1 SHALL report a diagnostic that names the path

### Requirement: Theme discovery may be switched off

T1.2 SHALL read `--no-themes` BEFORE T1.4 SHALL ask the resource loader for a theme.

#### Scenario: Discovery is off

- **WHEN** T1.2 reads `--no-themes`
- **THEN** T1.4 SHALL configure the loader with theme discovery off

#### Scenario: A requested theme survives the switch

- **WHEN** T1.2 reads `--no-themes` beside `--theme ./one.json`
- **THEN** T1.4 SHALL keep the requested theme available

### Requirement: A theme may be selected at startup

T1.3 SHALL select the named theme BEFORE the interface SHALL draw the first frame.

#### Scenario: A named theme

- **WHEN** T1.3 reads `--use-theme solarized`
- **THEN** T1.3 SHALL select `solarized` for the session

#### Scenario: The flag arrives without a name

- **WHEN** T1.3 reads `--use-theme` with no value
- **THEN** T1.3 SHALL refuse the invocation and name the flag

### Requirement: The help text names every theme flag

T1.5 SHALL print `--theme`, `--no-themes`, and `--use-theme` AFTER T1.1 SHALL read a theme value.

#### Scenario: A reader looks for the flags

- **WHEN** T1.5 prints the help text
- **THEN** T1.5 SHALL print all three flags with their arguments

### Requirement: The documentation follows the flags

T5.1 SHALL document every theme flag BEFORE T5.1 SHALL describe cache warming.

#### Scenario: A reader finds the flags in the README

- **WHEN** T5.1 documents the theme flags
- **THEN** T5.1 SHALL describe all three flags beside the other flags

#### Scenario: The warming limitation is gone

- **WHEN** T5.1 documents cache warming
- **THEN** T5.1 SHALL NOT describe warming as unavailable

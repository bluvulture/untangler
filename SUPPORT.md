# Support

- **Setup and usage questions:** open a GitHub issue with the `question`
  label (or a Discussion, if enabled).
- **Bugs:** use the bug-report issue template and include the diagnostics
  it asks for.

## Collecting diagnostics

```bash
journalctl /usr/bin/gnome-shell -b 0 --no-pager | grep -i untangler
```

Also useful: `gnome-extensions info untangler@bluvulture`,
`gnome-shell --version`, and your session type (`echo $XDG_SESSION_TYPE`).

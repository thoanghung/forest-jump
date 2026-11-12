import { describe, expect, it } from 'vitest'
import { buildLaunchArgs, splitArgs } from '../src/main/launch'

describe('splitArgs', () => {
  it('splits on whitespace and honours quotes', () => {
    expect(splitArgs('  code -n  ')).toEqual(['code', '-n'])
    expect(splitArgs(`a "b c" 'd e' f"g h"`)).toEqual(['a', 'b c', 'd e', 'fg h'])
    expect(splitArgs('a ""')).toEqual(['a', ''])
    expect(() => splitArgs('a "b')).toThrow(/Unclosed/)
  })
})

describe('buildLaunchArgs', () => {
  const p = '/home/me/my repo-feat'

  it('replaces {path} everywhere, keeping it one argument', () => {
    expect(buildLaunchArgs('wezterm start --new-tab --cwd {path} -- nvim {path}', p, true)).toEqual([
      'wezterm', 'start', '--new-tab', '--cwd', p, '--', 'nvim', p
    ])
    expect(buildLaunchArgs('foo --dir={path}/src', p, false)).toEqual(['foo', `--dir=${p}/src`])
  })

  it('without {path}: appends for the editor, not for the terminal', () => {
    expect(buildLaunchArgs('code', p, true)).toEqual(['code', p])
    expect(buildLaunchArgs('wezterm start', p, false)).toEqual(['wezterm', 'start'])
  })

  it('rejects an empty command', () => {
    expect(() => buildLaunchArgs('   ', p, true)).toThrow(/empty/)
  })
})

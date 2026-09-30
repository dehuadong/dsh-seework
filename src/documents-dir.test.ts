/**
 * The system's Documents directory — what the plugin's default material directory
 * hangs under.
 *
 * The recipes are pinned here because getting one wrong sends a user's library to a
 * folder they never open: a Chinese macOS calls that folder 文稿 rather than
 * Documents, and Windows may have relocated it (OneDrive, another drive). Every
 * failure has to end as `undefined` too — the caller falls back to `<home>/Documents`
 * — so nothing here throws.
 *
 * The Windows second question is pinned for the same reason: an application-control
 * policy refuses the .NET call (`Method invocation is supported only on core types
 * in this language mode`, verified on the machine this was written on), and the
 * registry answer is what keeps such a machine's default in the right folder.
 */

import { describe, expect, it } from 'vitest'
import { systemDocumentsDirectory } from './documents-dir.ts'

/** What `reg.exe query` prints for the shell's own record of the folder. */
const REG_OUTPUT = '\r\n'
  + 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders\r\n'
  + '    Personal    REG_EXPAND_SZ    D:\\Backup\\我的文档\r\n\r\n'

/** A runner that answers per command and records what it was asked. */
function fakeRun(answers: Record<string, string | Error>): {
  run: (command: string, args: readonly string[], signal: AbortSignal) => Promise<string>
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    run: async command => {
      calls.push(command)
      const answer = answers[command]
      if (answer === undefined) throw new Error(`no answer for ${command}`)
      if (answer instanceof Error) throw answer
      return answer
    },
  }
}

describe('systemDocumentsDirectory', () => {
  it('asks Windows for the folder this account really has', async () => {
    const fake = fakeRun({ 'powershell.exe': 'C:\\Users\\me\\OneDrive\\Documents\r\n' })
    expect(await systemDocumentsDirectory({ platform: 'win32', home: 'C:\\Users\\me', run: fake.run }))
      .toBe('C:\\Users\\me\\OneDrive\\Documents')
    expect(fake.calls).toEqual(['powershell.exe'])
  })

  it('asks the registry when a policy refuses the .NET call', async () => {
    // ConstrainedLanguage mode: `GetFolderPath` is refused outright.
    const fake = fakeRun({
      'powershell.exe': new Error('Method invocation is supported only on core types in this language mode.'),
      'reg.exe': REG_OUTPUT,
    })
    expect(await systemDocumentsDirectory({ platform: 'win32', home: 'C:\\Users\\me', run: fake.run }))
      .toBe('D:\\Backup\\我的文档')
    expect(fake.calls).toEqual(['powershell.exe', 'reg.exe'])
  })

  it('expands the variable a machine that never moved the folder spells out', async () => {
    const output = '    Personal    REG_EXPAND_SZ    %USERPROFILE%\\Documents\r\n'
    const fake = fakeRun({ 'powershell.exe': new Error('no shell'), 'reg.exe': output })
    expect(await systemDocumentsDirectory({ platform: 'win32', home: 'C:\\Users\\me', run: fake.run }))
      .toBe('C:\\Users\\me\\Documents')
  })

  it('asks macOS, where the folder may be named in the user\'s language', async () => {
    const fake = fakeRun({ osascript: '/Users/me/文稿\n' })
    expect(await systemDocumentsDirectory({ platform: 'darwin', home: '/Users/me', run: fake.run }))
      .toBe('/Users/me/文稿')
    expect(fake.calls).toEqual(['osascript'])
  })

  it('asks xdg on Linux, and refuses the answer that means "disabled"', async () => {
    const answered = fakeRun({ 'xdg-user-dir': '/home/me/Documents\n' })
    expect(await systemDocumentsDirectory({ platform: 'linux', home: '/home/me', run: answered.run }))
      .toBe('/home/me/Documents')
    expect(answered.calls).toEqual(['xdg-user-dir'])
    // XDG reports the home directory when this user directory is turned off, and
    // that is not a Documents folder.
    expect(await systemDocumentsDirectory({
      platform: 'linux', home: '/home/me', run: fakeRun({ 'xdg-user-dir': '/home/me\n' }).run,
    })).toBeUndefined()
  })

  it('answers nothing rather than guessing when the system cannot say', async () => {
    const failing = fakeRun({})
    expect(await systemDocumentsDirectory({ platform: 'win32', run: failing.run })).toBeUndefined()
    // An empty answer, a bare root, a value whose variable cannot be expanded, and
    // a platform with no recipe at all.
    expect(await systemDocumentsDirectory({
      platform: 'win32', run: fakeRun({ 'powershell.exe': '  \r\n' }).run,
    })).toBeUndefined()
    expect(await systemDocumentsDirectory({
      platform: 'win32', run: fakeRun({ 'powershell.exe': '\\' }).run,
    })).toBeUndefined()
    expect(await systemDocumentsDirectory({
      platform: 'win32',
      home: 'C:\\Users\\me',
      run: fakeRun({ 'powershell.exe': new Error('no shell'), 'reg.exe': '    Personal    REG_EXPAND_SZ    %NOPE%\\Docs\r\n' }).run,
    })).toBeUndefined()
    expect(await systemDocumentsDirectory({ platform: 'aix', run: fakeRun({}).run })).toBeUndefined()
  })

  it('takes a deployment\'s own answer instead of asking', async () => {
    const fake = fakeRun({})
    expect(await systemDocumentsDirectory({ platform: 'win32', documents: 'D:\\see\\documents', run: fake.run }))
      .toBe('D:\\see\\documents')
    expect(fake.calls).toEqual([])
    // A bad answer must not silently become the real folder.
    expect(await systemDocumentsDirectory({ platform: 'win32', documents: 'relative', run: fake.run })).toBeUndefined()
  })
})

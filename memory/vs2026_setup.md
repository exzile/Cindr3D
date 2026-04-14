---
name: Visual Studio 2026 Setup
description: VS 2026 .esproj configuration, F5 debugging, SDK version pinning
type: project
---

## Solution & Project Files
- `DesignCAD.slnx` — VS 2026 uses .slnx format (XML-based, replaces old .sln)
- `DesignCAD.esproj` — JavaScript project using `Microsoft.VisualStudio.JavaScript.Sdk/1.0.4338480`
- SDK version MUST be pinned to 1.0.4338480 (bundled with VS 2026). Unpinning causes "SDK not found" errors.

## F5 Debugging
- Uses `.vscode/launch.json` with Edge/Chrome debug configs pointing to `http://localhost:5173`
- `StartupCommand` in .esproj is `npm run dev` which starts Vite
- The command window appears starting the Vite dev server, browser launches separately

## Key .esproj Settings
```xml
<Project Sdk="Microsoft.VisualStudio.JavaScript.Sdk/1.0.4338480">
  <PropertyGroup>
    <StartupCommand>npm run dev</StartupCommand>
    <JavaScriptTestRoot>src\</JavaScriptTestRoot>
    <JavaScriptTestFramework>Vitest</JavaScriptTestFramework>
    <ShouldRunBuildScript>false</ShouldRunBuildScript>
    <BuildOutputFolder>$(MSBuildProjectDirectory)\dist</BuildOutputFolder>
  </PropertyGroup>
</Project>
```

## Common Issues
- `rimraf not found`: Install as devDependency, use `npx rimraf dist` in clean script
- `unable to start debugging, need a startup project`: Check project type GUID is `{54A90642-561A-45F1-AE2F-376B7DC203CF}` in .slnx
- Vite 8 rolldown bundler requires `import type` for TypeScript interfaces (MISSING_EXPORT errors otherwise)
- `ThreeEvent` from @react-three/fiber must use `import type { ThreeEvent }`

## Preview Server
- `.claude/launch.json` configured for Claude preview on port 5174 (5173 usually occupied by user's dev server)

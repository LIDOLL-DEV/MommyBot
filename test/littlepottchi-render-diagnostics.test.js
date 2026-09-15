import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { renderDollPng, DollRenderError } from "../src/dressup/render.js";

const doll = {player:{hair:"hair.png",face:"face.png"},base:"base.png",outfit:{}};

test("PNG failures distinguish setup, assets, permissions and timeout without echoing process output",async()=>{
  const cases = [
    [{code:"ENOENT"},"", "python_missing"],
    [{code:1},"ModuleNotFoundError: No module named 'PIL'", "pillow_missing"],
    [{code:1},"AttributeError: module 'PIL.Image' has no attribute 'Resampling'", "pillow_old"],
    [{code:2},"python3: can't open file '/PRIVATE/render_littlepottchi.py'", "renderer_missing"],
    [{code:1},"FileNotFoundError: /PRIVATE/doll.png", "asset_missing"],
    [{code:"EACCES"},"", "permission"],
    [{code:1},"PermissionError: /PRIVATE/doll.png", "permission"],
    [{killed:true},"", "timeout"],
    [{code:1},"PRIVATE unexpected failure", "failed"],
    [null,"", "invalid_png"],
  ];
  for (const [error,stderr,code] of cases) {
    const execute = (_executable,_args,options,callback) => {
      assert.equal(options.windowsHide,true); assert.equal(options.timeout,15000); assert.equal(options.shell,undefined);
      return {stdin:{on:()=>{},end:()=>queueMicrotask(()=>callback(error,Buffer.from("not a png"),Buffer.from(`${stderr}\nPRIVATE_SECRET`)))}};
    };
    await assert.rejects(renderDollPng(doll,execute),failure=>{
      assert.ok(failure instanceof DollRenderError); assert.equal(failure.code,code);
      assert.doesNotMatch(failure.message,/PRIVATE/); return true;
    });
  }
});

test("the operator preflight fails clearly when its configured interpreter cannot be started",async()=>{
  const script=fileURLToPath(new URL("../scripts/check-doll-render.mjs",import.meta.url));
  await assert.rejects(promisify(execFile)(process.execPath,[script],{
    env:{...process.env,LITTLEPOTTCHI_PYTHON:fileURLToPath(new URL("./missing-python-fixture",import.meta.url))},windowsHide:true,
  }), error=>{
    assert.equal(error.code,1); assert.match(error.stderr,/Python could not be started/);
    assert.doesNotMatch(error.stderr,/missing-python-fixture|Traceback/); return true;
  });
});

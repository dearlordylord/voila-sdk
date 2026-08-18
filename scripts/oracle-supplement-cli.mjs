const summarizeCliResult = (result) => ({ exitCode: result.exitCode, stderr: result.stderr, stdout: result.stdout })

const failingPorts = {
  login: async () => ({ ok: false, error: { _tag: "VoilaAuthRequired", message: "Synthetic login failure" } }),
  runOperation: async () => ({
    ok: false,
    error: { _tag: "VoilaConnectionFailure", message: "Synthetic operation failure" }
  })
}

export const captureCliSupplement = async (cli) => ({
  help: summarizeCliResult(await cli.runCli(["orders", "--help"], failingPorts)),
  operationFailureJson: summarizeCliResult(
    await cli.runCli(["orders", "list", "--json", "--session", "/tmp/voila-oracle-session.json"], failingPorts)
  ),
  operationFailureText: summarizeCliResult(
    await cli.runCli(["orders", "list", "--session", "/tmp/voila-oracle-session.json"], failingPorts)
  )
})

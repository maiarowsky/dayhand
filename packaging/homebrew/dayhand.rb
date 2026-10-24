# Template of the Homebrew formula for dayhand, for a tap repository
# (<owner>/homebrew-dayhand, file Formula/dayhand.rb). Fill in after `npm publish`:
# the tarball's SHA-256 (docs/release.md); with a scoped package name, also `url`
# (.../@<scope>/dayhand/-/dayhand-<version>.tgz). release-please keeps the version current.
# Nothing is published yet.
class Dayhand < Formula
  desc "Command-line client for the Dayhand task manager, for people and agents"
  homepage "https://github.com/maiarowsky/helm"
  url "https://registry.npmjs.org/dayhand/-/dayhand-0.12.0.tgz" # x-release-please-version
  sha256 "REPLACE_WITH_THE_SHA256_OF_THE_NPM_TARBALL"
  license "Apache-2.0"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    # dayhand and dh; hlm, the old name, only lives in the npm package until 1.0.
    bin.install_symlink libexec/"bin/dayhand", libexec/"bin/dh"
    man1.install Dir[libexec/"lib/node_modules/dayhand/man/*.1"]
    generate_completions_from_executable(bin/"dayhand", "completion")
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/dayhand --version")
    assert_match version.to_s, shell_output("#{bin}/dh --version")
    assert_match "dayhand __complete", shell_output("#{bin}/dayhand completion bash")
    # No server is configured: a command that needs one is a usage error (exit 2), not a crash.
    shell_output("#{bin}/dayhand list --json 2>&1", 2)
  end
end

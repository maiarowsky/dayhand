# Homebrew formula for dayhand, kept here and copied into the tap maiarowsky/homebrew-tap
# (file Formula/dayhand.rb), so that `brew install maiarowsky/tap/dayhand` works. It installs the
# package from the npm registry; after each `npm publish`, set `sha256` to the checksum of that
# tarball (docs/release.md). release-please keeps the version in `url` current.
class Dayhand < Formula
  desc "Command-line client for the Dayhand task manager, for people and agents"
  homepage "https://github.com/maiarowsky/dayhand"
  url "https://registry.npmjs.org/dayhand/-/dayhand-0.14.0.tgz" # x-release-please-version
  sha256 "0000000000000000000000000000000000000000000000000000000000000000" # the npm tarball's, after publishing
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

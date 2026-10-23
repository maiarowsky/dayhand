# Template of the Homebrew formula for hlm, for a tap repository
# (<owner>/homebrew-hlm, file Formula/hlm.rb). Fill in after `npm publish`:
# the package name in `url` (scoped: .../@<scope>/hlm/-/hlm-<version>.tgz) and the
# tarball's SHA-256 (docs/release.md). release-please keeps the version current.
class Hlm < Formula
  desc "Command-line client for the Helm task manager, for people and agents"
  homepage "https://github.com/<owner>/helm"
  url "https://registry.npmjs.org/hlm/-/hlm-0.9.0.tgz" # x-release-please-version
  sha256 "REPLACE_WITH_THE_SHA256_OF_THE_NPM_TARBALL"
  license "Apache-2.0"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
    man1.install Dir[libexec/"lib/node_modules/**/man/hlm.1"].first
    generate_completions_from_executable(bin/"hlm", "completion")
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/hlm --version")
    assert_match "hlm __complete", shell_output("#{bin}/hlm completion bash")
    # No server is configured: a command that needs one is a usage error (exit 2), not a crash.
    shell_output("#{bin}/hlm list --json 2>&1", 2)
  end
end

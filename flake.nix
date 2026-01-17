{
  description = "SecureLLM MCP Server - Hybrid Node.js/Rust Environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    # Rust Overlay para versões precisas se necessário
    rust-overlay.url = "github:oxalica/rust-overlay";
    rust-overlay.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nixpkgs, flake-utils, rust-overlay, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        overlays = [ (import rust-overlay) ];
        pkgs = import nixpkgs {
          inherit system overlays;
        };
        
        # Toolchain Rust estável com suporte a análise de código
        rustToolchain = pkgs.rust-bin.stable.latest.default.override {
          extensions = [ "rust-src" "rust-analyzer" "clippy" ];
        };

      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            # Node.js Environment (Legacy/Transition)
            nodejs_20
            nodePackages.npm
            nodePackages.typescript
            nodePackages.typescript-language-server

            # Rust Environment (New Architecture)
            rustToolchain
            pkg-config
            openssl
            sqlite
            
            # Utils
            ripgrep
            jq
          ];

          shellHook = ''
            export LD_LIBRARY_PATH=${pkgs.openssl.out}/lib:$LD_LIBRARY_PATH
            echo "🛡️ SecureLLM Dev Environment (Node.js + Rust) Loaded"
            echo "Rust Version: $(rustc --version)"
            echo "Node Version: $(node --version)"
          '';
        };
      }
    );
}
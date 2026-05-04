# Reproducible Emscripten toolchain for ARACHNE-9 WASM builds.
#
# Pinned to emsdk 3.1.74 — stable as of Q1 2026 and known to compile
# header-only Boost without needing -fexceptions hacks.
#
# Vendored libraries (header-only):
#   - boost.polygon   — boost::polygon::voronoi (Fortune sweep-line)
#   - boost.geometry  — used by libArachne for polygon ops in 9.2C
#
# Build:   docker build -t cindr3d-wasm -f wasm/Dockerfile wasm
# Run:     docker run --rm -v "$PWD/wasm:/wasm" cindr3d-wasm /wasm/build.sh
#
FROM emscripten/emsdk:3.1.74

ARG BOOST_VERSION=1.84.0
ARG BOOST_UNDERSCORE=1_84_0
ARG CLIPPER2_TAG=Clipper2_1.5.4

USER root

# Fetch Boost source, copy only the header subtrees we use, drop the rest.
# Total vendored payload ends up ~25MB instead of 600MB+ for full Boost.
RUN set -eux; \
    cd /tmp; \
    curl -fsSL -o boost.tar.bz2 \
      "https://archives.boost.io/release/${BOOST_VERSION}/source/boost_${BOOST_UNDERSCORE}.tar.bz2"; \
    tar -xjf boost.tar.bz2; \
    mkdir -p /opt/boost/include/boost; \
    cp -r "boost_${BOOST_UNDERSCORE}/boost/polygon"   /opt/boost/include/boost/polygon; \
    cp -r "boost_${BOOST_UNDERSCORE}/boost/geometry"  /opt/boost/include/boost/geometry; \
    cp -r "boost_${BOOST_UNDERSCORE}/boost/range"     /opt/boost/include/boost/range; \
    cp -r "boost_${BOOST_UNDERSCORE}/boost/mpl"       /opt/boost/include/boost/mpl; \
    cp -r "boost_${BOOST_UNDERSCORE}/boost/preprocessor" /opt/boost/include/boost/preprocessor; \
    cp -r "boost_${BOOST_UNDERSCORE}/boost/type_traits"  /opt/boost/include/boost/type_traits; \
    cp -r "boost_${BOOST_UNDERSCORE}/boost/utility"   /opt/boost/include/boost/utility; \
    cp -r "boost_${BOOST_UNDERSCORE}/boost/concept"   /opt/boost/include/boost/concept; \
    cp -r "boost_${BOOST_UNDERSCORE}/boost/iterator"  /opt/boost/include/boost/iterator; \
    cp -r "boost_${BOOST_UNDERSCORE}/boost/detail"    /opt/boost/include/boost/detail; \
    cp -r "boost_${BOOST_UNDERSCORE}/boost/config"    /opt/boost/include/boost/config; \
    find "boost_${BOOST_UNDERSCORE}/boost" -maxdepth 1 -name '*.hpp' -exec cp {} /opt/boost/include/boost/ \; ; \
    rm -rf "boost_${BOOST_UNDERSCORE}" boost.tar.bz2

ENV BOOST_INCLUDE=/opt/boost/include
ENV CLIPPER2_INCLUDE=/opt/clipper2/include
ENV CLIPPER2_SRC=/opt/clipper2/src

# Fetch Clipper2 C++ headers + sources used by 9.4A's WASM offset module.
RUN set -eux; \
    cd /tmp; \
    curl -fsSL -o clipper2.tar.gz \
      "https://github.com/AngusJohnson/Clipper2/archive/refs/tags/${CLIPPER2_TAG}.tar.gz"; \
    tar -xzf clipper2.tar.gz; \
    mkdir -p /opt/clipper2/include /opt/clipper2/src; \
    cp -r "Clipper2-${CLIPPER2_TAG}/CPP/Clipper2Lib/include/clipper2" /opt/clipper2/include/clipper2; \
    cp "Clipper2-${CLIPPER2_TAG}/CPP/Clipper2Lib/src/"*.cpp /opt/clipper2/src/; \
    rm -rf "Clipper2-${CLIPPER2_TAG}" clipper2.tar.gz

WORKDIR /wasm

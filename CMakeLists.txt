cmake_minimum_required(VERSION 3.15.0)
project(BSplineDemo VERSION 0.1.0)

# Requires c++17 and no compiler extension
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(index src/main.cpp)
set(CMAKE_EXECUTABLE_SUFFIX ".html")
target_link_options(index PUBLIC -sMIN_WEBGL_VERSION=2)
target_link_options(index PUBLIC -sOFFSCREENCANVAS_SUPPORT)
target_link_options(index PUBLIC --embed-file ${CMAKE_CURRENT_SOURCE_DIR}/src/shader@shader)
target_compile_options(index PUBLIC -fwasm-exceptions)
target_link_options(index PUBLIC -fwasm-exceptions)
# target_compile_definitions(index PUBLIC "EXPLICIT_SWAP")

target_compile_options(index PUBLIC -Weverything -Wno-c++98-compat -Wno-c++98-compat-pedantic -Wno-pre-c++14-compat)

set(CPACK_PROJECT_NAME ${PROJECT_NAME})
set(CPACK_PROJECT_VERSION ${PROJECT_VERSION})
include(CPack)

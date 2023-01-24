cmake_minimum_required(VERSION 3.15.0)
project(BSplineDemo VERSION 0.1.0)

# Requires c++17 and no compiler extension
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(index src/main.cpp)
set(CMAKE_EXECUTABLE_SUFFIX ".html")

set(CPACK_PROJECT_NAME ${PROJECT_NAME})
set(CPACK_PROJECT_VERSION ${PROJECT_VERSION})
include(CPack)

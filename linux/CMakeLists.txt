cmake_minimum_required(VERSION 3.21)

project(dayhand-qt VERSION 0.1.0 DESCRIPTION "Dayhand for Linux" LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_AUTOMOC ON)

option(DAYHAND_BUILD_APP "Build the dayhand-qt application (needs Qt Quick)" ON)
option(DAYHAND_BUILD_TESTS "Build the QtTest suites" ON)

find_package(Qt6 6.5 REQUIRED COMPONENTS Core Sql Network)
find_package(PkgConfig REQUIRED)
pkg_check_modules(LIBSECRET REQUIRED IMPORTED_TARGET libsecret-1)

include(GNUInstallDirs)

add_compile_options(-Wall -Wextra -Wpedantic)
add_compile_definitions(QT_NO_CAST_FROM_ASCII QT_NO_URL_CAST_FROM_STRING QT_NO_CAST_FROM_BYTEARRAY)

# The rules, the database and sync: everything without a screen, so tests can use it on their own.
add_library(dayhand_core STATIC
    src/core/CivilDate.cpp
    src/core/ConvexRemote.cpp
    src/core/Credentials.cpp
    src/core/Database.cpp
    src/core/Formatting.cpp
    src/core/HelmDates.cpp
    src/core/Http.cpp
    src/core/PairingApi.cpp
    src/core/PairingInput.cpp
    src/core/QuickAdd.cpp
    src/core/Recurrence.cpp
    src/core/ReminderPlanner.cpp
    src/core/Reminders.cpp
    src/core/RemoteModel.cpp
    src/core/SecretServiceStore.cpp
    src/core/SnapshotMerger.cpp
    src/core/SyncEngine.cpp
    src/core/SyncWorker.cpp
    src/core/TaskItem.cpp
    src/core/TaskRepository.cpp
    src/core/TaskRows.cpp
    src/core/TaskRules.cpp
    src/core/TodaySections.cpp
    src/core/WhenParser.cpp
)
target_include_directories(dayhand_core PUBLIC src/core)
target_link_libraries(dayhand_core PUBLIC Qt6::Core Qt6::Sql Qt6::Network PRIVATE PkgConfig::LIBSECRET)

if(DAYHAND_BUILD_APP)
    add_subdirectory(src/app)
endif()

if(DAYHAND_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()

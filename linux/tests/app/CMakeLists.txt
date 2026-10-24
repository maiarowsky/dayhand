# dayhand_app_test(<name> [LAUNCHER <command…>] [ENV <VAR=value…>])
function(dayhand_app_test name)
    cmake_parse_arguments(TEST "" "" "LAUNCHER;ENV" ${ARGN})
    add_executable(${name} ${name}.cpp)
    target_link_libraries(${name} PRIVATE dayhand_app dayhand_testsupport Qt6::Test)
    add_test(NAME ${name} COMMAND ${TEST_LAUNCHER} $<TARGET_FILE:${name}>)
    # The software renderer, so window snapshots need no GPU.
    set_tests_properties(${name} PROPERTIES ENVIRONMENT
        "QT_QPA_PLATFORM=offscreen;QT_QUICK_BACKEND=software;TZ=UTC;${TEST_ENV}")
endfunction()

dayhand_app_test(tst_app)

# Notifications and the tray talk to services on the session bus, and the tray needs a real windowing platform
# (the offscreen one has none), so these run as clients of a headless Weston on a private bus, with fake desktop
# services the test runs itself.
find_program(DBUS_RUN_SESSION dbus-run-session)
find_program(WESTON weston)
if(DBUS_RUN_SESSION AND WESTON)
    set(on_wayland sh ${CMAKE_CURRENT_SOURCE_DIR}/run-wayland.sh)
    dayhand_app_test(tst_desktop LAUNCHER ${on_wayland})
    add_test(NAME smoke_wayland COMMAND ${on_wayland} sh ${CMAKE_CURRENT_SOURCE_DIR}/smoke.sh $<TARGET_FILE:dayhand-qt>)
    set_tests_properties(smoke_wayland PROPERTIES ENVIRONMENT "TZ=UTC")
else()
    message(STATUS "weston or dbus-run-session not found: tst_desktop and smoke_wayland are not run")
endif()

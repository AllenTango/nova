// Windows release 构建下防止弹出额外控制台窗口——绝对不要删！
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nova_lib::run()
}

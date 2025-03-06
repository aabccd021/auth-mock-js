goto --url "http://localhost:3000\
?response_type=code\
&state=sfZavFFyK5PDKdkEtHoOZ5GdXZtY1SwCTsHzlh6gHm4\
&code_verifier=AWnuB2qLobencpDhxdlDb_yeTixrfG9SiKYOjwYrz4I\
&scope=\
&client_id=mock_client_id\
&redirect_uri=http://localhost:3000/login-callback\
"

assert_response_code_equal 200

printf "mysub" >google_auth_id_token_sub.txt
submit "//form" --data "google_auth_id_token_sub=google_auth_id_token_sub.txt"

assert_response_code_equal 200

keys=$(jq -r "keys[]" "$NETERO_DIR/body" | tr '\n' ' ')
assert_equal "access_token expires_in scope token_type " "$keys"

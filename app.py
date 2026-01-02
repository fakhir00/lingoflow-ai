import streamlit as st

st.title("Hāzar Sarkar 🛠️")
st.write("Welcome lingoflow Ai!")

# Simple Chat Interface
user_input = st.text_input("Type your question here:")
if user_input:
    st.write(f"You asked: {user_input}")
    st.write("This is a demo response. The full AI is coming soon!")
